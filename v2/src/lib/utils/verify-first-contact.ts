import { resolveFirstContactStatus } from './first-contact-status-resolver';

function runTests() {
  const tests = [
    {
      name: "1. Brand new lead, no messages, no outreach",
      phones: [{ phone: '905551234567', label: 'form' as const, isPrimary: true }],
      outreach: [],
      inbound: [],
      expected: 'needs_greeting'
    },
    {
      name: "2. Lead with inbound message, no outreach",
      phones: [{ phone: '905551234567', label: 'form' as const, isPrimary: true }],
      outreach: [],
      inbound: [{ created_at: new Date().toISOString(), phone: '905551234567' }],
      expected: 'waiting_inbox_reply'
    },
    {
      name: "3. Operator opens WhatsApp, no message confirmed",
      phones: [{ phone: '905551234567', label: 'form' as const, isPrimary: true }],
      outreach: [{ action: 'whatsapp_app_opened_for_greeting', created_at: new Date().toISOString(), target_phone: '905551234567' }],
      inbound: [],
      expected: 'whatsapp_opened'
    },
    {
      name: "4. Operator manually confirmed greeting via echo",
      phones: [{ phone: '905551234567', label: 'form' as const, isPrimary: true }],
      outreach: [
        { action: 'whatsapp_app_opened_for_greeting', created_at: new Date(Date.now() - 10000).toISOString(), target_phone: '905551234567' },
        { action: 'manual_whatsapp_greeting_echo_confirmed', created_at: new Date().toISOString(), target_phone: '905551234567' }
      ],
      inbound: [],
      expected: 'manual_greeting_confirmed'
    },
    {
      name: "5. Form greeting sent via Inbox panel (no reply yet)",
      phones: [{ phone: '905551234567', label: 'form' as const, isPrimary: true }],
      outreach: [{ action: 'inbox_form_greeting_sent', created_at: new Date().toISOString(), target_phone: '905551234567' }],
      inbound: [],
      expected: 'inbox_greeting_sent'
    },
    {
      name: "6. API greeting sent (template_sent)",
      phones: [{ phone: '905551234567', label: 'form' as const, isPrimary: true }],
      outreach: [{ action: 'template_sent', created_at: new Date().toISOString(), target_phone: '905551234567' }],
      inbound: [],
      expected: 'inbox_greeting_sent'
    },
    {
      name: "7. Patient replied after manual greeting",
      phones: [{ phone: '905551234567', label: 'form' as const, isPrimary: true }],
      outreach: [
        { action: 'manual_whatsapp_greeting_echo_confirmed', created_at: new Date(Date.now() - 100000).toISOString(), target_phone: '905551234567' }
      ],
      inbound: [
        { created_at: new Date(Date.now() - 10000).toISOString(), phone: '905551234567' }
      ],
      expected: 'patient_replied'
    },
    {
      name: "8. Patient replied after inbox greeting",
      phones: [{ phone: '905551234567', label: 'form' as const, isPrimary: true }],
      outreach: [
        { action: 'inbox_form_greeting_sent', created_at: new Date(Date.now() - 100000).toISOString(), target_phone: '905551234567' }
      ],
      inbound: [
        { created_at: new Date(Date.now() - 10000).toISOString(), phone: '905551234567' }
      ],
      expected: 'patient_replied'
    },
    {
      name: "9. Patient replied after API template greeting",
      phones: [{ phone: '905551234567', label: 'form' as const, isPrimary: true }],
      outreach: [
        { action: 'template_sent', created_at: new Date(Date.now() - 100000).toISOString(), target_phone: '905551234567' }
      ],
      inbound: [
        { created_at: new Date(Date.now() - 10000).toISOString(), phone: '905551234567' }
      ],
      expected: 'patient_replied'
    },
    {
      name: "10. Inbound before greeting, then greeted manually, no reply yet -> manual_greeting_confirmed",
      phones: [{ phone: '905551234567', label: 'form' as const, isPrimary: true }],
      outreach: [
        { action: 'manual_whatsapp_greeting_echo_confirmed', created_at: new Date(Date.now() - 10000).toISOString(), target_phone: '905551234567' }
      ],
      inbound: [
        { created_at: new Date(Date.now() - 100000).toISOString(), phone: '905551234567' } // old inbound
      ],
      expected: 'manual_greeting_confirmed'
    },
    {
      name: "11. Inbound before greeting, greeted via inbox, no reply yet -> inbox_greeting_sent",
      phones: [{ phone: '905551234567', label: 'form' as const, isPrimary: true }],
      outreach: [
        { action: 'inbox_form_greeting_sent', created_at: new Date(Date.now() - 10000).toISOString(), target_phone: '905551234567' }
      ],
      inbound: [
        { created_at: new Date(Date.now() - 100000).toISOString(), phone: '905551234567' } // old inbound
      ],
      expected: 'inbox_greeting_sent'
    },
    {
      name: "12. Inbound before greeting, greeted via API, no reply yet -> patient_replied (WAIT, API greeting sent means they replied? Let's check logic)",
      // Note: current logic says if anyInbound and anyApiSent, it returns patient_replied which might be a slight bug if lastInbound is older than greeting.
      // Let's test the current output.
      phones: [{ phone: '905551234567', label: 'form' as const, isPrimary: true }],
      outreach: [
        { action: 'template_sent', created_at: new Date(Date.now() - 10000).toISOString(), target_phone: '905551234567' }
      ],
      inbound: [
        { created_at: new Date(Date.now() - 100000).toISOString(), phone: '905551234567' } // old inbound
      ],
      expected: 'inbox_greeting_sent' // Should conceptually be treated same as inbox_greeting_sent if last inbound was BEFORE greeting.
    },
    {
      name: "13. No phone numbers -> blocked_or_invalid",
      phones: [],
      outreach: [],
      inbound: [],
      expected: 'blocked_or_invalid'
    },
    {
      name: "14. Multiple phones, secondary has inbound, no outreach -> waiting_inbox_reply with recommendedPhone=secondary",
      phones: [
        { phone: '905551111111', label: 'form' as const, isPrimary: true },
        { phone: '905552222222', label: 'secondary' as const, isPrimary: false }
      ],
      outreach: [],
      inbound: [
        { created_at: new Date().toISOString(), phone: '905552222222' }
      ],
      expected: 'waiting_inbox_reply'
    },
    {
      name: "15. Patient writes repeatedly before greeting -> waiting_inbox_reply",
      phones: [{ phone: '905551234567', label: 'form' as const, isPrimary: true }],
      outreach: [],
      inbound: [
        { created_at: new Date(Date.now() - 100000).toISOString(), phone: '905551234567' },
        { created_at: new Date(Date.now() - 50000).toISOString(), phone: '905551234567' }
      ],
      expected: 'waiting_inbox_reply'
    },
    {
      name: "16. Patient writes after multiple greetings -> patient_replied",
      phones: [{ phone: '905551234567', label: 'form' as const, isPrimary: true }],
      outreach: [
        { action: 'whatsapp_app_opened_for_greeting', created_at: new Date(Date.now() - 200000).toISOString(), target_phone: '905551234567' },
        { action: 'manual_whatsapp_greeting_echo_confirmed', created_at: new Date(Date.now() - 100000).toISOString(), target_phone: '905551234567' }
      ],
      inbound: [
        { created_at: new Date(Date.now() - 50000).toISOString(), phone: '905551234567' }
      ],
      expected: 'patient_replied'
    }
  ];

  let passed = 0;
  for (const t of tests) {
    const res = resolveFirstContactStatus(t.phones, t.outreach, t.inbound);
    if (res.patientLevelStatus !== t.expected) {
      console.error(`FAIL: ${t.name}. Expected ${t.expected}, got ${res.patientLevelStatus}`);
    } else {
      console.log(`PASS: ${t.name}`);
      passed++;
    }
  }
  console.log(`\nResult: ${passed}/${tests.length} passed.`);
}

runTests();
