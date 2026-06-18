/**
 * P0.16-F: DepartmentAliasResolver
 *
 * Lightweight, tenant-safe resolver that maps inbound complaint/topic keywords
 * to canonical department names. Used to derive the "activeDepartment" from the
 * CURRENT user message — overriding any stale CRM/opportunity department context.
 *
 * Rules:
 * - No hardcoded doctor names or lists.
 * - No DB migrations — reads from brain.context.config.departmentAliases if present,
 *   falls back to DEFAULT_ALIAS_MAP.
 * - All keyword matching is case-insensitive, ASCII-normalised.
 * - Returns null if no match found (caller decides what to do with null).
 */

export interface DepartmentAliasResult {
  /** Canonical department name (e.g. "Beyin ve Sinir Cerrahisi") */
  canonical: string;
  /** Short display label for conversational text (e.g. "beyin ve sinir cerrahisi") */
  displayLabel: string;
  /** The keyword that triggered the match */
  matchedKeyword: string;
}

// Default alias map: keyword (lowercase, normalised) → canonical name
const DEFAULT_ALIAS_MAP: { keywords: string[]; canonical: string; displayLabel: string }[] = [
  {
    canonical: 'Beyin ve Sinir Cerrahisi',
    displayLabel: 'beyin ve sinir cerrahisi (nöroşirürji)',
    keywords: [
      'bel fıtığı', 'bel fitigi', 'bel fıtıgı', 'bel fitigi',
      'boyun fıtığı', 'boyun fitigi', 'boyun fıtıgı',
      'fıtık', 'fitik', 'fıtıgı', 'fitigi',
      'bel ağrısı', 'bel agrisi',
      'boyun ağrısı', 'boyun agrisi',
      // P0.16-H: explicit dept phrase keywords (e.g. "beyin sinir cerrahisi doktorları kim")
      'beyin sinir cerrahisi', 'beyin ve sinir cerrahisi',
      'sinir cerrahisi', 'beyin cerrahisi', 'nöroşirürji', 'norosiruji',
      'omurilik', 'disk hernisi', 'disk herniation',
      'bacak uyuşması', 'bacak uyusmasi', 'el uyuşması', 'el uyusmasi',
      'omurga'
    ]
  },
  {
    canonical: 'Kardiyoloji',
    displayLabel: 'kardiyoloji',
    keywords: [
      'kardiyoloji', 'kalp', 'damar', 'kalp ritmi', 'ritim bozukluğu',
      'ritim bozuklugu', 'anjiyografi', 'anjiyoplasti', 'anjiyo',
      'koroner', 'bypass', 'pacemaker', 'kalp yetmezliği', 'kalp yetmezligi',
      'cardiology', 'cardio', 'heart'
    ]
  },
  {
    canonical: 'Plastik, Rekonstrüktif ve Estetik Cerrahi',
    displayLabel: 'plastik ve estetik cerrahi',
    keywords: [
      'estetik', 'plastik cerrahi', 'rinoplasti', 'burun estetiği',
      'burun estetigi', 'rhinoplasty', 'liposuction', 'botoks', 'dolgu',
      'meme estetiği', 'meme estetigi', 'yüz germe', 'yuz germe',
      'saç ekimi', 'sac ekimi', 'abdominoplasti', 'karın germe', 'karin germe'
    ]
  },
  {
    canonical: 'Organ Nakli Merkezi',
    displayLabel: 'organ nakli',
    keywords: [
      'organ nakli', 'karaciğer nakli', 'karaciger nakli',
      'böbrek nakli', 'bobrek nakli', 'transplant', 'liver transplant',
      'kidney transplant', 'organ transplant', 'nakil merkezi'
    ]
  },
  {
    canonical: 'Ortopedi ve Travmatoloji',
    displayLabel: 'ortopedi ve travmatoloji',
    keywords: [
      'ortopedi', 'kırık', 'kirik', 'eklem', 'diz', 'kalça', 'kalca',
      'omuz', 'bilek', 'ayak bileği', 'ayak bilegi', 'spor yaralanması',
      'spor yaralanmasi', 'menisküs', 'meniskus', 'ligament'
    ]
  },
  {
    canonical: 'Göz Hastalıkları',
    displayLabel: 'göz hastalıkları',
    keywords: [
      'göz', 'goz', 'katarakt', 'lasik', 'laser göz', 'laser goz',
      'görme bozukluğu', 'gorme bozuklugu', 'retina', 'glokom', 'şaşılık', 'sasılik'
    ]
  },
  {
    canonical: 'Kulak Burun Boğaz',
    displayLabel: 'kulak burun boğaz (KBB)',
    keywords: [
      'kbb', 'kulak burun bogaz', 'kulak burun boğaz', 'septorinoplasti',
      'sinüzit', 'sinuzit', 'bademcik', 'kulak tıkanıklığı', 'kulak tikanikligi',
      'ses kısıklığı', 'ses kisikligi', 'burun tıkanıklığı', 'burun tikanikligi'
    ]
  },
  {
    canonical: 'Gastroenteroloji',
    displayLabel: 'gastroenteroloji',
    keywords: [
      'mide', 'bağırsak', 'bagırsak', 'ülser', 'ulser', 'gastrit',
      'reflü', 'reflu', 'kolonoskopi', 'gastroskopi', 'karaciğer', 'karaciger',
      'sarılık', 'sarilık', 'hepatit', 'crohn', 'ibs', 'irritabl bağırsak'
    ]
  },
  {
    canonical: 'Onkoloji',
    displayLabel: 'onkoloji',
    keywords: [
      'kanser', 'tümör', 'tumor', 'kemoterapi', 'radyoterapi', 'onkoloji',
      'lenfoma', 'lösemi', 'losemi', 'biyopsi', 'metastaz'
    ]
  },
  {
    canonical: 'Kadın Hastalıkları ve Doğum',
    displayLabel: 'kadın hastalıkları ve doğum',
    keywords: [
      'jinekoloji', 'kadın doğum', 'kadin dogum', 'rahim', 'yumurtalık',
      'yumurtalik', 'myom', 'kist', 'histeroskopi', 'laparoskopi', 'sezeryan',
      'normal doğum', 'normal dogum', 'gebelik', 'hamilelik', 'menopoz'
    ]
  },
  {
    canonical: 'Tüp Bebek Merkezi',
    displayLabel: 'tüp bebek (IVF)',
    keywords: [
      'tüp bebek', 'tup bebek', 'ivf', 'infertilite', 'kısırlık', 'kisirlik',
      'sperm', 'embriyo', 'iui', 'yumurta donasyonu'
    ]
  },
  {
    canonical: 'Üroloji',
    displayLabel: 'üroloji',
    keywords: [
      'üroloji', 'uroloji', 'böbrek taşı', 'bobrek tasi', 'mesane',
      'prostat', 'idrar yolu', 'böbrek', 'bobrek', 'üroterapi'
    ]
  }
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/İ/g, 'i').replace(/I/g, 'ı')
    .replace(/ğ/g, 'g').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ç/g, 'c')
    .trim();
}

export class DepartmentAliasResolver {
  /**
   * Resolves the canonical department from the inbound message text.
   * Checks tenant config aliases first, then falls back to DEFAULT_ALIAS_MAP.
   *
   * @param inboundText - Raw inbound user message text
   * @param tenantAliasConfig - Optional tenant-specific alias map from brain.context.config.departmentAliases
   * @returns DepartmentAliasResult if matched, null otherwise
   */
  public static resolve(
    inboundText: string,
    tenantAliasConfig?: Record<string, string> | null
  ): DepartmentAliasResult | null {
    if (!inboundText) return null;

    const normalizedInbound = normalize(inboundText);
    const rawLower = inboundText.toLowerCase().trim();

    // 1. Check tenant-specific alias config first (from brain.context.config.departmentAliases)
    if (tenantAliasConfig && typeof tenantAliasConfig === 'object') {
      for (const [keyword, canonical] of Object.entries(tenantAliasConfig)) {
        const normKey = normalize(keyword);
        if (normalizedInbound.includes(normKey) || rawLower.includes(keyword.toLowerCase())) {
          return {
            canonical: String(canonical),
            displayLabel: String(canonical).toLowerCase(),
            matchedKeyword: keyword
          };
        }
      }
    }

    // 2. Check default alias map
    for (const entry of DEFAULT_ALIAS_MAP) {
      for (const kw of entry.keywords) {
        const normKw = normalize(kw);
        if (normalizedInbound.includes(normKw) || rawLower.includes(kw.toLowerCase())) {
          return {
            canonical: entry.canonical,
            displayLabel: entry.displayLabel,
            matchedKeyword: kw
          };
        }
      }
    }

    return null;
  }

  /**
   * Resolves the active department from current user message text,
   * then validates against (optional) stale CRM department.
   * If the resolved department differs from the stale one, returns the new one.
   * If no match found and stale is present, returns null to signal "no override".
   *
   * @param inboundText - Current user message
   * @param staleDepartment - The department already in CRM/opportunity context
   * @param tenantAliasConfig - Optional tenant alias map
   */
  public static resolveWithStalenessCheck(
    inboundText: string,
    staleDepartment: string | null,
    tenantAliasConfig?: Record<string, string> | null
  ): { activeDepartment: string | null; isOverride: boolean } {
    const resolved = this.resolve(inboundText, tenantAliasConfig);

    if (!resolved) {
      // No match in current message — keep stale as-is
      return { activeDepartment: staleDepartment, isOverride: false };
    }

    if (!staleDepartment) {
      // No stale context — use newly resolved department
      return { activeDepartment: resolved.canonical, isOverride: true };
    }

    const normResolved = normalize(resolved.canonical);
    const normStale = normalize(staleDepartment);

    if (normResolved !== normStale) {
      // Current message explicitly references a DIFFERENT department — override stale
      return { activeDepartment: resolved.canonical, isOverride: true };
    }

    // Same department — no change needed
    return { activeDepartment: resolved.canonical, isOverride: false };
  }
}
