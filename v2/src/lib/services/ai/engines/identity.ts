import { withTenantDB } from '@/lib/core/tenant-db';

export class IdentityEngine {

  /**
   * Flow: Webhook -> normalizePhone() -> find/create customer_profiles -> return customerId
   */
  static async resolveIdentity(params: {
    tenantId: string;
    phoneNumber: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    source?: 'manual' | 'form' | 'patient_statement' | 'whatsapp_profile' | 'ai_extracted' | 'phone_fallback';
    allPhones?: string[];
  }): Promise<string> {
    const { tenantId, phoneNumber, email, firstName, lastName, source = 'whatsapp_profile', allPhones } = params;

    if (!phoneNumber) {
      throw new Error('[IdentityEngine] Phone number is required for identity resolution.');
    }

    const { normalizePhoneForIdentity } = await import('@/lib/utils/phone-identity');

    const idObj = normalizePhoneForIdentity(phoneNumber);
    const normalizedPhone = idObj.e164 || idObj.digits;

    const searchPhones = new Set<string>();
    searchPhones.add(normalizedPhone);
    if (allPhones && allPhones.length > 0) {
      for (const p of allPhones) {
        const parsedId = normalizePhoneForIdentity(p);
        const norm = parsedId.e164 || parsedId.digits;
        if (norm) searchPhones.add(norm);
      }
    }
    const phonesList = Array.from(searchPhones);

    try {
      const db = withTenantDB(tenantId);
      let cid: string;

      const existing = await db.executeSafe({
        text: `SELECT id, first_name, primary_phone FROM customer_profiles WHERE tenant_id = $1 AND primary_phone = ANY($2)`,
        values: [tenantId, phonesList]
      }) as any[];

      if (existing.length > 1) {
        console.warn(`[IdentityEngine] COLLISION: Multiple customer profiles found for phones ${phonesList.join(', ')}. Linking requires manual review.`);
        
        // Find if one matches the primary phone exactly
        const exactPrimaryMatch = existing.find(p => p.primary_phone === normalizedPhone);
        if (exactPrimaryMatch) {
          cid = exactPrimaryMatch.id;
        } else {
          // If no profile matches the primary phone exactly, create a new one to avoid wrong merge
          const result = await db.executeSafe({
            text: `
              INSERT INTO customer_profiles (tenant_id, primary_phone, primary_email, first_name, last_name)
              VALUES ($1, $2, $3, $4, $5)
              RETURNING id;
            `,
            values: [tenantId, normalizedPhone, email || null, firstName || null, lastName || null]
          }) as any[];
          cid = result[0].id;
        }

        // Flag needs_manual_review on the conversation tag and insert system timeline message
        try {
          await db.executeSafe({
            text: `
              UPDATE conversations
              SET tags = CASE 
                WHEN tags IS NULL OR tags = '' OR tags = '[]' THEN '["needs_manual_review"]'
                WHEN tags::jsonb @> '["needs_manual_review"]' THEN tags
                ELSE (tags::jsonb || '["needs_manual_review"]'::jsonb)::text
              END
              WHERE tenant_id = $1 AND phone_number = ANY($2)
            `,
            values: [tenantId, phonesList]
          });

          // Insert system message for each conversation
          for (const phone of phonesList) {
            const conv = await db.executeSafe({
              text: `SELECT id FROM conversations WHERE phone_number = $1 AND tenant_id = $2`,
              values: [phone, tenantId]
            }) as any[];
            if (conv.length > 0) {
              await db.executeSafe({
                text: `INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, channel, status)
                       VALUES ($1, $2, $3, 'system', $4, 'whatsapp', 'sent')`,
                values: [
                  tenantId,
                  conv[0].id,
                  phone,
                  `[Sistem Uyarısı] Çoklu telefon çakışması tespit edildi. Bu konuşma manuel inceleme gerektiriyor.`
                ]
              });
            }
          }

          // Write audit log
          await db.executeSafe({
            text: `INSERT INTO ai_audit_logs (tenant_id, action, reasoning_summary, result_summary)
                   VALUES ($1, $2, $3, $4)`,
            values: [
              tenantId,
              'identity_collision_detected',
              'Multiple customer profiles found matching allPhones array during resolveIdentity',
              JSON.stringify({
                phones: phonesList,
                profiles_found: existing.map(e => ({ id: e.id, name: e.first_name })),
                assigned_customer_id: cid
              })
            ]
          });
        } catch (tagErr) {
          console.warn('[IdentityEngine] Failed to flag needs_manual_review for collision', tagErr);
        }
      } else if (existing.length === 1) {
        cid = existing[0].id;
        const currentName = existing[0].first_name;
        
        let shouldUpdate = false;
        const isPhoneLike = !currentName || /^[0-9+\-\s()]+$/.test(currentName);
        const isIsimsiz = /isimsiz/i.test(currentName || '');

        if (!currentName || isPhoneLike || isIsimsiz) {
          shouldUpdate = true;
        } else if (source === 'manual' || source === 'form') {
          shouldUpdate = true;
        }

        if (shouldUpdate && firstName && firstName.trim() !== '' && firstName !== currentName) {
          await db.executeSafe({
            text: `
              UPDATE customer_profiles 
              SET first_name = $1, 
                  primary_email = COALESCE(primary_email, $2),
                  updated_at = NOW() 
              WHERE id = $3 AND tenant_id = $4
            `,
            values: [firstName, email || null, cid, tenantId]
          });
        }
      } else {
        const result = await db.executeSafe({
          text: `
            INSERT INTO customer_profiles (tenant_id, primary_phone, primary_email, first_name, last_name)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id;
          `,
          values: [tenantId, normalizedPhone, email || null, firstName || null, lastName || null]
        }) as any[];
        cid = result[0].id;
      }

      // Retroactive SaaS identity merge for orphaned records
      try {
        // 1. High-confidence exact matches
        await db.executeSafe({
          text: `
            UPDATE leads
            SET customer_id = $1
            WHERE tenant_id = $2 
              AND customer_id IS NULL
              AND (
                phone_number = $3
                OR (
                  raw_data IS NOT NULL 
                  AND raw_data != ''
                  AND raw_data LIKE '%_all_phones%'
                  AND (
                    CASE
                      WHEN jsonb_typeof(raw_data::jsonb->'_all_phones') = 'array' 
                        THEN (raw_data::jsonb->'_all_phones') @> jsonb_build_array($3)
                      WHEN jsonb_typeof(raw_data::jsonb->'_all_phones') = 'string' 
                        THEN (raw_data::jsonb->>'_all_phones')::jsonb @> jsonb_build_array($3)
                      ELSE false
                    END
                  )
                )
              )
          `,
          values: [cid, tenantId, normalizedPhone]
        });
        
        await db.executeSafe({
          text: `
            UPDATE conversations
            SET customer_id = $1
            WHERE tenant_id = $2
              AND customer_id IS NULL
              AND phone_number = $3
          `,
          values: [cid, tenantId, normalizedPhone]
        });

        // Opportunities exact match retroactive link
        await db.executeSafe({
          text: `
            UPDATE opportunities
            SET customer_id = $1
            WHERE tenant_id = $2
              AND customer_id IS NULL
              AND (
                phone_number = $3
                OR conversation_id IN (
                  SELECT id FROM conversations 
                  WHERE tenant_id = $2 
                    AND (customer_id = $1 OR phone_number = $3)
                )
              )
          `,
          values: [cid, tenantId, normalizedPhone]
        });
        console.log(JSON.stringify({
          tag: 'RETROACTIVE_OPPORTUNITY_LINK',
          tenantId,
          customerId: cid,
          phoneNumber: normalizedPhone,
          matchReason: 'exact_phone_or_conversation_match'
        }));

        // 2. Safe suffix match fallback (checked for uniqueness and country compatibility)
        const suffix = normalizedPhone.slice(-10);

        const leadCandidates = await db.executeSafe({
          text: `SELECT id, phone_number FROM leads WHERE tenant_id = $1 AND customer_id IS NULL AND RIGHT(phone_number, 10) = $2`,
          values: [tenantId, suffix]
        }) as any[];

        if (leadCandidates.length === 1) {
          const cand = leadCandidates[0];
          const idCand = normalizePhoneForIdentity(cand.phone_number);
          const idOrig = normalizePhoneForIdentity(normalizedPhone);
          if (idCand.nationalSuffix === idOrig.nationalSuffix && idCand.countryHint === idOrig.countryHint) {
            await db.executeSafe({
              text: `UPDATE leads SET customer_id = $1 WHERE id = $2 AND tenant_id = $3`,
              values: [cid, cand.id, tenantId]
            });
          }
        }

        const convCandidates = await db.executeSafe({
          text: `SELECT id, phone_number FROM conversations WHERE tenant_id = $1 AND customer_id IS NULL AND RIGHT(phone_number, 10) = $2`,
          values: [tenantId, suffix]
        }) as any[];

        if (convCandidates.length === 1) {
          const cand = convCandidates[0];
          const idCand = normalizePhoneForIdentity(cand.phone_number);
          const idOrig = normalizePhoneForIdentity(normalizedPhone);
          if (idCand.nationalSuffix === idOrig.nationalSuffix && idCand.countryHint === idOrig.countryHint) {
            await db.executeSafe({
              text: `UPDATE conversations SET customer_id = $1 WHERE id = $2 AND tenant_id = $3`,
              values: [cid, cand.id, tenantId]
            });
          }
        }

        // Opportunities suffix match retroactive link
        const oppCandidates = await db.executeSafe({
          text: `SELECT id, phone_number FROM opportunities WHERE tenant_id = $1 AND customer_id IS NULL AND RIGHT(phone_number, 10) = $2`,
          values: [tenantId, suffix]
        }) as any[];

        if (oppCandidates.length === 1) {
          const cand = oppCandidates[0];
          const idCand = normalizePhoneForIdentity(cand.phone_number);
          const idOrig = normalizePhoneForIdentity(normalizedPhone);
          if (idCand.nationalSuffix === idOrig.nationalSuffix && idCand.countryHint === idOrig.countryHint) {
            await db.executeSafe({
              text: `UPDATE opportunities SET customer_id = $1 WHERE id = $2 AND tenant_id = $3`,
              values: [cid, cand.id, tenantId]
            });
            console.log(JSON.stringify({
              tag: 'RETROACTIVE_OPPORTUNITY_LINK',
              tenantId,
              opportunityId: cand.id,
              customerId: cid,
              phoneNumber: normalizedPhone,
              matchReason: 'suffix_match'
            }));
          }
        }
      } catch (mergeError) {
        console.warn('[IdentityEngine] Non-fatal: Orphaned records merge failed', mergeError);
      }

      return cid;
    } catch (error) {
      console.error('[IdentityEngine] Failed to resolve identity:', error);
      throw error;
    }
  }

  static async linkConversation(tenantId: string, conversationId: string, customerId: string): Promise<void> {
    const db = withTenantDB(tenantId);
    await db.executeSafe({
      text: `
        UPDATE conversations 
        SET customer_id = $1, updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3;
      `,
      values: [customerId, conversationId, tenantId]
    });
  }

  static async linkLead(tenantId: string, leadId: string, customerId: string): Promise<void> {
    const db = withTenantDB(tenantId);
    await db.executeSafe({
      text: `
        UPDATE leads 
        SET customer_id = $1
        WHERE id = $2 AND tenant_id = $3;
      `,
      values: [customerId, leadId, tenantId]
    });
  }
  public static sanitizeFormFacts(rawData: any): string[] {
    if (!rawData) return [];
    let formObj: any = rawData;
    if (typeof rawData === 'string') {
      try {
        formObj = JSON.parse(rawData);
      } catch {
        return [];
      }
    }
    if (!formObj || typeof formObj !== 'object') return [];

    const facts: string[] = [];
    const getVal = (keys: string[]) => {
      for (const key of keys) {
        if (key in formObj) {
          const val = formObj[key];
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            return String(val).trim();
          }
        }
      }
      return null;
    };

    const name = getVal(['full_name', 'ad_soyad', 'name']);
    const age = getVal(['yas', 'yaş', 'age']);
    const country = getVal(['ulke', 'ülke', 'country', 'nerede_yaşıyorsunuz']);
    const complaint = getVal(['sikayet', 'şikayet', 'şikayetiniz_nedir', 'sikayetiniz_nedir']);
    const duration = getVal(['sure', 'süre', 'ne_kadardir_suruyor']);
    const randevu = getVal(['randevu_ayi', 'randevu_tarihi', 'ne_zaman_gelmek_istiyorsunuz']);
    const aramaSaati = getVal(['ne_zaman_arayalim', 'arama_saati', 'call_time', 'callback_time', 'aranma_zamani', 'aranma_saati', 'preferred_call_time']);
    const phone = getVal(['telefon', 'phone']);

    if (name) facts.push(`Hastanın adı: ${name}.`);
    if (age) facts.push(`Hastanın yaşı: ${age}.`);
    if (country) facts.push(`Hastanın yaşadığı ülke/yer: ${country}.`);
    if (complaint) facts.push(`Hastanın şikayeti: ${complaint}.`);
    if (duration) facts.push(`Hastanın şikayet süresi: ${duration}.`);
    if (randevu) facts.push(`Geliş zamanı: ${randevu}.`);
    if (aramaSaati) facts.push(`Arama için uygun zaman: ${aramaSaati}.`);
    if (phone) facts.push(`Hastanın iletişim numarası: ${phone}.`);

    return facts;
  }

  /**
   * Unified context based ONLY on customer_id, no fuzzy matching here.
   */
  static async getContext(tenantId: string, customerId: string, conversationId?: string): Promise<any> {
    try {
      const db = withTenantDB(tenantId);
      const profiles = await db.executeSafe({
        text: `SELECT * FROM customer_profiles WHERE id = $1 AND tenant_id = $2`,
        values: [customerId, tenantId]
      }) as any[];
      const profile = profiles[0];
      if (!profile) return null;

      let lead = null;
      const leads = await db.executeSafe({
        text: `
          SELECT id, form_name, raw_data, channel_id, tenant_id, created_at
          FROM leads 
          WHERE tenant_id = $1 AND customer_id = $2
          ORDER BY created_at DESC 
          LIMIT 1
        `,
        values: [tenantId, customerId]
      }) as any[];
      lead = leads[0];

      if (!lead && profile.primary_phone) {
        const suffix = profile.primary_phone.slice(-10);
        const fallbackLeads = await db.executeSafe({
          text: `
            SELECT id, form_name, raw_data, channel_id, tenant_id, created_at
            FROM leads 
            WHERE tenant_id = $1 
              AND (phone_number = $2 OR RIGHT(phone_number, 10) = $3)
            ORDER BY created_at DESC 
            LIMIT 1
          `,
          values: [tenantId, profile.primary_phone, suffix]
        }) as any[];
        lead = fallbackLeads[0];

        // Retroactively link this lead to the customer_id so future queries match fast
        if (lead) {
          await db.executeSafe({
            text: `UPDATE leads SET customer_id = $1 WHERE id = $2 AND tenant_id = $3`,
            values: [customerId, lead.id, tenantId]
          }).catch((err: any) => console.warn('[IdentityEngine] Non-fatal retroactive lead link failed', err));
        }
      }

      let memory = null;
      if (conversationId) {
         const memories = await db.executeSafe({
           text: `SELECT * FROM conversation_memory WHERE conversation_id = $1 AND tenant_id = $2`,
           values: [conversationId, tenantId]
         }) as any[];
         memory = memories[0];
      }

      // ── Step 1: Explicit active_opportunity_id from conversation ──
      let opportunity = null;
      let resolvedFrom = 'none';
      let conversationRow = null;

      if (conversationId) {
        const convRows = await db.executeSafe({
          text: `SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          values: [conversationId, tenantId]
        }) as any[];
        if (convRows.length > 0) {
          conversationRow = convRows[0];
          const activeOppId = conversationRow.active_opportunity_id;
          if (activeOppId) {
            const oppRows = await db.executeSafe({
              text: `SELECT * FROM opportunities WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
              values: [activeOppId, tenantId]
            }) as any[];
            if (oppRows.length > 0) {
              opportunity = oppRows[0];
              resolvedFrom = 'explicit_active_id';
            }
          }
        }
      }

      // ── Step 2: Active opportunity in same conversation + tenant ──
      if (!opportunity && conversationId) {
        const oppRows = await db.executeSafe({
          text: `
            SELECT * FROM opportunities 
            WHERE conversation_id = $1 AND tenant_id = $2 
              AND stage NOT IN ('lost', 'not_qualified', 'arrived')
            ORDER BY updated_at DESC
            LIMIT 1
          `,
          values: [conversationId, tenantId]
        }) as any[];
        if (oppRows.length > 0) {
          opportunity = oppRows[0];
          resolvedFrom = 'active_conv_opp';
        }
      }

      // ── Step 3: Same lead/form active opportunity ──
      if (!opportunity && lead) {
        const leadIdQuery = await db.executeSafe({
          text: `SELECT id, linked_opportunity_id FROM leads WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at DESC LIMIT 1`,
          values: [tenantId, customerId]
        }) as any[];
        if (leadIdQuery.length > 0) {
          const lId = leadIdQuery[0].id;
          const lLinkedOppId = leadIdQuery[0].linked_opportunity_id;
          
          if (lLinkedOppId) {
            const oppRows = await db.executeSafe({
              text: `
                SELECT * FROM opportunities 
                WHERE id = $1 AND tenant_id = $2 
                  AND stage NOT IN ('lost', 'not_qualified', 'arrived')
                LIMIT 1
              `,
              values: [lLinkedOppId, tenantId]
            }) as any[];
            if (oppRows.length > 0) {
              opportunity = oppRows[0];
              resolvedFrom = 'lead_linked_active_opp';
            }
          }
          
          if (!opportunity) {
            const oppRows = await db.executeSafe({
              text: `
                SELECT * FROM opportunities 
                WHERE lead_id = $1 AND tenant_id = $2 
                  AND stage NOT IN ('lost', 'not_qualified', 'arrived')
                ORDER BY updated_at DESC
                LIMIT 1
              `,
              values: [lId, tenantId]
            }) as any[];
            if (oppRows.length > 0) {
              opportunity = oppRows[0];
              resolvedFrom = 'lead_id_active_opp';
            }
          }
        }
      }

      // ── Step 4: Fallback - Latest non-terminal (inactive/terminal in same conversation and tenant) ──
      if (!opportunity && conversationId) {
        const oppRows = await db.executeSafe({
          text: `
            SELECT * FROM opportunities 
            WHERE conversation_id = $1 AND tenant_id = $2
              AND stage IN ('lost', 'not_qualified', 'arrived')
            ORDER BY updated_at DESC
            LIMIT 1
          `,
          values: [conversationId, tenantId]
        }) as any[];
        if (oppRows.length > 0) {
          opportunity = oppRows[0];
          resolvedFrom = 'inactive_conv_opp_fallback';
        }
      }

      // ── Step 5: Fallback - Phone suffix match (Read-only recovery) ──
      if (!opportunity && profile.primary_phone) {
        const suffix = profile.primary_phone.slice(-10);
        const oppRows = await db.executeSafe({
          text: `
            SELECT * FROM opportunities 
            WHERE tenant_id = $1 
              AND customer_id IS NULL 
              AND (phone_number = $2 OR RIGHT(phone_number, 10) = $3)
              AND stage NOT IN ('lost', 'not_qualified', 'arrived')
            ORDER BY updated_at DESC
            LIMIT 1
          `,
          values: [tenantId, profile.primary_phone, suffix]
        }) as any[];
        if (oppRows.length > 0) {
          opportunity = oppRows[0];
          resolvedFrom = 'phone_suffix_active_opp';
        }
      }

      // ═══ Form Context binding with verified tenant & channel checks ═══
      let isFormBound = false;
      if (lead && lead.tenant_id === tenantId) {
        if (conversationRow) {
          const conversationChannelId = conversationRow.channel_id;
          const leadChannelId = lead.channel_id;
          // Must match channel_id if both are present
          if (!leadChannelId || !conversationChannelId || leadChannelId === conversationChannelId) {
            isFormBound = true;
          }
        } else {
          isFormBound = true;
        }
      }

      // ═══ [FIX-C] Auto-heal stale patient_name from form ═══
      // If form has a valid name AND opportunity/conversation has a wrong name,
      // silently correct it. Guards: isValidPatientName + name_locked check.
      if (isFormBound && lead && conversationId) {
        try {
          const { isValidPatientName } = await import('@/lib/utils/patient-name-resolver');
          let formName: string | null = null;
          if (lead.patient_name && isValidPatientName(lead.patient_name)) {
            formName = lead.patient_name.trim();
          }

          if (formName) {
            const oppMeta = opportunity?.metadata
              ? (typeof opportunity.metadata === 'string'
                  ? (() => { try { return JSON.parse(opportunity.metadata); } catch { return {}; } })()
                  : opportunity.metadata)
              : {};
            const isLocked = oppMeta?.name_locked === true;

            if (!isLocked) {
              const currentConvName = conversationRow?.patient_name || '';
              const currentOppName  = opportunity?.patient_name || '';

              // Only heal if current name looks wrong (not valid patient name)
              const convNameBad = currentConvName && !isValidPatientName(currentConvName);
              const oppNameBad  = currentOppName  && !isValidPatientName(currentOppName);

              if (convNameBad || oppNameBad) {
                // Heal conversation patient_name
                if (convNameBad) {
                  await db.executeSafe({
                    text: `UPDATE conversations SET patient_name = $1, updated_at = NOW()
                           WHERE id = $2 AND tenant_id = $3`,
                    values: [formName, conversationId, tenantId]
                  });
                  if (conversationRow) conversationRow.patient_name = formName;
                }
                // Heal opportunity patient_name
                if (oppNameBad && opportunity?.id) {
                  await db.executeSafe({
                    text: `UPDATE opportunities SET patient_name = $1, updated_at = NOW()
                           WHERE id = $2 AND tenant_id = $3`,
                    values: [formName, opportunity.id, tenantId]
                  });
                  if (opportunity) opportunity.patient_name = formName;
                }
                console.info(`[IdentityEngine][FIX-C] Auto-healed patient_name to "${formName}" from form`);
              }
            }
          }

          // ─── [FIX-C-2] Auto-heal department from form onerilen_bolum ───
          try {
            let parsedRaw: any = {};
            if (typeof lead.raw_data === 'string') {
              try { parsedRaw = JSON.parse(lead.raw_data); } catch {}
            } else if (lead.raw_data && typeof lead.raw_data === 'object') {
              parsedRaw = lead.raw_data;
            }
            // Use normalized key lookup (same approach as safeLatestForm)
            const normalizedKeyMap2: Record<string, string> = {};
            for (const k of Object.keys(parsedRaw)) {
              const nk = k.toLowerCase().replace(/\s+/g, '_').replace(/[çç]/g, 'c').replace(/[şş]/g, 's').replace(/[ğğ]/g, 'g').replace(/[üü]/g, 'u').replace(/[öö]/g, 'o').replace(/[ıiİI]/g, 'i');
              normalizedKeyMap2[nk] = k;
            }
            const deptNk = Object.keys(normalizedKeyMap2).find(nk =>
              nk.includes('bolum') || nk.includes('department') || nk.includes('onerilen') || nk.includes('uzmanlik')
            );
            const formDept = deptNk ? String(parsedRaw[normalizedKeyMap2[deptNk]]).trim() : null;

            if (formDept) {
              const currentDept = conversationRow?.department || opportunity?.department || '';
              const deptIsEmpty = !currentDept || currentDept.toLowerCase() === 'genel';
              if (deptIsEmpty) {
                await db.executeSafe({
                  text: `UPDATE conversations SET department = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
                  values: [formDept, conversationId, tenantId]
                });
                if (opportunity?.id) {
                  await db.executeSafe({
                    text: `UPDATE opportunities SET department = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
                    values: [formDept, opportunity.id, tenantId]
                  });
                }
                console.info(`[IdentityEngine][FIX-C-2] Auto-healed department to "${formDept}" from form`);
              }
            }
          } catch (_) { /* non-fatal */ }

          // ─── [FIX-C-3] Auto-heal tags from lead.form_name if tags are empty ───
          try {
            const currentTags = conversationRow?.tags;
            const parsedTags = (() => {
              if (!currentTags) return [];
              if (Array.isArray(currentTags)) return currentTags;
              if (typeof currentTags === 'string') {
                try { return JSON.parse(currentTags); } catch { return []; }
              }
              return [];
            })();
            const tagsEmpty = !parsedTags || parsedTags.length === 0;
            if (tagsEmpty && lead.form_name) {
              const freshTags = JSON.stringify([lead.form_name]);
              await db.executeSafe({
                text: `UPDATE conversations SET tags = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
                values: [freshTags, conversationId, tenantId]
              });
              console.info(`[IdentityEngine][FIX-C-3] Auto-seeded tags from form_name "${lead.form_name}"`);
            }
          } catch (_) { /* non-fatal */ }

        } catch (_) { /* non-fatal — never block context loading */ }
      }


      // ═══ Load last 10 messages for conversation history ═══

      let history: { role: string; content: string }[] = [];
      if (conversationId) {
        const msgRows = await db.executeSafe({
          text: `
            SELECT direction, content 
            FROM messages 
            WHERE conversation_id = $1 AND tenant_id = $2 AND direction IN ('in', 'out')
              AND COALESCE(media_metadata->>'deleted_at', '') = ''
            ORDER BY created_at DESC 
            LIMIT 10
          `,
          values: [conversationId, tenantId]
        }) as any[];
        history = msgRows.reverse().map((m: any) => ({
          role: m.direction === 'in' ? 'user' : 'assistant',
          content: m.content || ''
        }));
      }

      // ═══ Safe latestForm containing ONLY permitted safe fields (NO RAW DATA LEAKED) ═══
      const safeLatestForm = (isFormBound && lead) ? (() => {
        let parsed: any = {};
        if (typeof lead.raw_data === 'string') {
          try { parsed = JSON.parse(lead.raw_data); } catch {}
        } else if (lead.raw_data && typeof lead.raw_data === 'object') {
          parsed = lead.raw_data;
        }
        
        const safeData: any = {};
        const nameVal = parsed.full_name || parsed.ad_soyad || parsed.name || parsed['full name'] || parsed['Full Name'] || null;
        if (nameVal) safeData.full_name = String(nameVal).trim();

        // Normalize all keys once for fuzzy matching (handles mixed-case Turkish form labels)
        const normalizedKeyMap: Record<string, string> = {};
        for (const k of Object.keys(parsed)) {
          const normalized = k.toLowerCase().replace(/\s+/g, '_').replace(/[çç]/g, 'c').replace(/[şş]/g, 's').replace(/[ğğ]/g, 'g').replace(/[üü]/g, 'u').replace(/[öö]/g, 'o').replace(/[ıiİI]/g, 'i');
          normalizedKeyMap[normalized] = k;
        }

        // Country: match keys containing 'ulke', 'country', 'where', 'yasiyor', 'live'
        const countryKey = Object.keys(normalizedKeyMap).find(nk =>
          nk.includes('ulke') || nk.includes('country') || nk.includes('where') || nk.includes('live') || nk === 'nerede_yasiyorsunuz'
        );
        const countryVal = countryKey ? parsed[normalizedKeyMap[countryKey]] : (parsed.ulke || parsed.country || null);
        if (countryVal) safeData.country = String(countryVal).trim();

        // Complaint: match keys containing 'sikayet', 'complaint', 'problem', 'durum'
        const complaintKey = Object.keys(normalizedKeyMap).find(nk =>
          nk.includes('sikayet') || nk.includes('complaint') || nk.includes('saglik') || nk.includes('durum') || nk.includes('ozet')
        );
        const complaintVal = complaintKey ? parsed[normalizedKeyMap[complaintKey]] : (parsed.sikayet || null);
        if (complaintVal) safeData.sikayet = String(complaintVal).trim();

        // Travel date / available time: match keys containing 'randevu', 'zaman', 'tarih', 'gelis', 'when' (but exclude callback/call terms)
        const timeKey = Object.keys(normalizedKeyMap).find(nk =>
          (nk.includes('randevu') || nk.includes('zaman') || nk.includes('tarih') || nk.includes('gelis') || nk.includes('when')) &&
          !nk.includes('arayalim') && !nk.includes('arama') && !nk.includes('call') && !nk.includes('callback')
        );
        const timeVal = timeKey ? parsed[normalizedKeyMap[timeKey]] : (parsed.randevu_ayi || parsed.randevu_tarihi || null);
        if (timeVal) safeData.randevu_ayi = String(timeVal).trim();

        // Call time: match keys containing 'arayalim', 'arama', 'call', 'callback'
        const callTimeKey = Object.keys(normalizedKeyMap).find(nk =>
          nk.includes('arayalim') || nk.includes('arama') || nk.includes('call') || nk.includes('callback')
        );
        const callTimeVal = callTimeKey ? parsed[normalizedKeyMap[callTimeKey]] : null;
        if (callTimeVal) safeData.arama_saati = String(callTimeVal).trim();

        // Recommended department (önerilen bölüm) from form
        const deptKey = Object.keys(normalizedKeyMap).find(nk =>
          nk.includes('bolum') || nk.includes('department') || nk.includes('onerilen') || nk.includes('uzmanlik')
        );
        const deptVal = deptKey ? parsed[normalizedKeyMap[deptKey]] : null;
        if (deptVal) safeData.onerilen_bolum = String(deptVal).trim();

        // Appointment preference / randevu tercihi (often contains the main complaint text)
        const appointKey = Object.keys(normalizedKeyMap).find(nk =>
          nk.includes('randevu_tercihi') || nk.includes('appointment') || nk.includes('tercih') || nk.includes('aciklama') || nk.includes('mesaj') || nk.includes('arayalim') || nk.includes('arama') || nk.includes('tedavi') || nk.includes('not')
        );
        const appointVal = appointKey ? parsed[normalizedKeyMap[appointKey]] : null;
        if (appointVal) safeData.randevu_tercihi = String(appointVal).trim();


        return {
          id: lead.id,
          name: lead.form_name,
          data: safeData,
          created_at: lead.created_at
        };
      })() : null;

      // ═══ Resolve facts securely via ConversationKnownFactsResolver ═══
      const { ConversationKnownFactsResolver } = await import('@/lib/services/ai/conversation-known-facts-resolver');
      const resolvedFacts = ConversationKnownFactsResolver.resolve({
        history,
        opportunity: opportunity ? {
          patient_name: opportunity.patient_name,
          country: opportunity.country,
          department: opportunity.department,
          travel_date: opportunity.travel_date,
          metadata: typeof opportunity.metadata === 'string'
            ? (() => { try { return JSON.parse(opportunity.metadata); } catch { return {}; } })()
            : (opportunity.metadata || {})
        } : undefined,
        profile,
        latestForm: safeLatestForm,
        conversation: conversationRow ? {
          patient_name: conversationRow.patient_name,
          name: conversationRow.name,
          country: conversationRow.country,
          department: conversationRow.department
        } : undefined
      });

      const patient_known_facts = ConversationKnownFactsResolver.formatFacts(resolvedFacts);

      // ═══ B2 FIX: Outreach context for form lead bot handoff ═══
      let outreachContext = null;
      if (lead) {
        try {
          const leadRows = await db.executeSafe({
            text: `SELECT id FROM leads WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at DESC LIMIT 1`,
            values: [tenantId, customerId]
          }) as any[];

          if (leadRows.length > 0) {
            const leadId = leadRows[0].id;

            const outreachRows = await db.executeSafe({
              text: `SELECT action, metadata, created_at FROM outreach_logs 
                     WHERE lead_id = $1 AND tenant_id = $2 
                     ORDER BY created_at DESC LIMIT 10`,
              values: [leadId, tenantId]
            }) as any[];

            if (outreachRows.length > 0) {
              const greetingSent = outreachRows.some((r: any) => r.action === 'greeting_sent');
              const botActivated = outreachRows.some((r: any) => r.action === 'bot_activated');
              const lastCallRow = outreachRows.find((r: any) => 
                ['called_reached', 'called_missed', 'callback_scheduled'].includes(r.action)
              );

              outreachContext = {
                source: 'form_lead',
                greetingSent,
                botActivated,
                lastCallAction: lastCallRow?.action || null,
                lastCallNote: lastCallRow?.metadata?.note || null,
              };
            }
          }
        } catch (ocErr) {
          console.warn('[IdentityEngine] Non-fatal: outreachContext query failed', ocErr);
        }
      }

      // ── Step 5: Active task & bot directive loading ──
      let activeTask = null;
      let activeBotDirective = null;
      try {
        if (opportunity) {
          const taskRows = await db.executeSafe({
            text: `SELECT id, task_type, title, metadata FROM follow_up_tasks 
                   WHERE opportunity_id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress')
                   ORDER BY created_at DESC LIMIT 1`,
            values: [opportunity.id, tenantId]
          }) as any[];
          activeTask = taskRows[0] || null;
        } else if (conversationId) {
          const taskRows = await db.executeSafe({
            text: `SELECT id, task_type, title, metadata FROM follow_up_tasks 
                   WHERE conversation_id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress')
                   ORDER BY created_at DESC LIMIT 1`,
            values: [conversationId, tenantId]
          }) as any[];
          activeTask = taskRows[0] || null;
        }

        if (activeTask) {
          const taskMeta = activeTask.metadata || {};
          const state = taskMeta.bot_directive_state;
          if (state && state.directive_status === 'pending') {
            activeBotDirective = state.active_bot_directive;
          } else if (taskMeta.active_bot_directive) {
            const isPending = taskMeta.bot_teyit_sent || taskMeta.bot_hatirlat_sent || taskMeta.bot_devret_sent;
            if (isPending) {
              activeBotDirective = taskMeta.active_bot_directive;
            }
          }
        }
      } catch (taskErr) {
        console.warn('[IdentityEngine] Non-fatal: active task query failed', taskErr);
      }

      // ═══ Country confidence scoring ═══
      let countryConfidence: import('@/lib/utils/country-confidence').CountryConfidenceResult | null = null;
      try {
        const { evaluateCountryConfidence } = await import('@/lib/utils/country-confidence');
        const oppMeta = opportunity?.metadata
          ? (typeof opportunity.metadata === 'string'
              ? (() => { try { return JSON.parse(opportunity.metadata); } catch { return {}; } })()
              : opportunity.metadata)
          : {};
        const formCountry = safeLatestForm?.data?.country || null;
        const phoneCountry = (() => {
          const phone = conversationRow?.phone_number || '';
          if (phone.startsWith('90')) return 'T\u00fcrkiye';
          if (phone.startsWith('49')) return 'Almanya';
          if (phone.startsWith('44')) return '\u0130ngiltere';
          if (phone.startsWith('33')) return 'Fransa';
          if (phone.startsWith('31')) return 'Hollanda';
          if (phone.startsWith('32')) return 'Bel\u00e7ika';
          if (phone.startsWith('998')) return '\u00d6zbekistan';
          if (phone.startsWith('994')) return 'Azerbaycan';
          if (phone.startsWith('7')) return 'Rusya';
          if (phone.startsWith('1')) return 'ABD';
          return null;
        })();
        countryConfidence = evaluateCountryConfidence({
          formCountry,
          phoneCountry,
          crmCountry: opportunity?.country || conversationRow?.country || null,
          confirmed: oppMeta?.country_confirmed === true
        });
      } catch (_) { /* non-fatal */ }

      return {
        profile,
        latestForm: safeLatestForm,
        patient_known_facts,
        memory: memory ? {
           summary: memory.summary_text,
           intent: memory.buying_intent,
           sentiment: memory.sentiment,
           objections: memory.objections
        } : null,
        opportunity: opportunity ? {
           id: opportunity.id,
           summary: opportunity.summary,
           ai_reason: opportunity.ai_reason,
           patient_name: opportunity.patient_name,
           country: opportunity.country,
           department: opportunity.department,
           travel_date: opportunity.travel_date,
           stage: opportunity.stage,
           metadata: typeof opportunity.metadata === 'string'
             ? JSON.parse(opportunity.metadata)
             : (opportunity.metadata || {}),
           resolvedFrom
        } : null,
        outreachContext,
        conversation: conversationRow ? {
          id: conversationRow.id,
          status: conversationRow.status,
          patient_name: conversationRow.patient_name,
          country: conversationRow.country,
          department: conversationRow.department,
          notes: conversationRow.notes,
          wa_profile_name: conversationRow.wa_profile_name,
          name: conversationRow.name,
          tags: conversationRow.tags,
          metadata: typeof conversationRow.metadata === 'string'
            ? JSON.parse(conversationRow.metadata)
            : (conversationRow.metadata || {})
        } : null,
        active_task: activeTask ? {
          id: activeTask.id,
          task_type: activeTask.task_type,
          title: activeTask.title,
          active_bot_directive: activeBotDirective,
          metadata: typeof activeTask.metadata === 'string'
            ? JSON.parse(activeTask.metadata)
            : (activeTask.metadata || {})
        } : null,
        // ── Confirmation flags ──
        // nameConfirmed: true = patient confirmed their name in a previous interaction
        // countryConfidence: scoring result from country-confidence util
        nameConfirmed: (() => {
          const meta = opportunity?.metadata
            ? (typeof opportunity.metadata === 'string'
                ? (() => { try { return JSON.parse(opportunity.metadata); } catch { return {}; } })()
                : opportunity.metadata)
            : {};
          return meta?.name_confirmed === true || meta?.name_locked === true;
        })(),
        countryConfidence,
      };
    } catch (e) {
      console.error('[IdentityEngine] Failed to get context', e);
      return null;
    }
  }
}
