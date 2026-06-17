export interface TopicSwitchResult {
  hasSwitched: boolean;
  activeTopic: string | null;
  previousTopics: string[];
}

export class ConversationTopicSwitchResolver {
  private static DEPARTMENTS = [
    { name: 'Kardiyoloji', keywords: ['kalp', 'kardiyo', 'kardiyoloji', 'heart', 'coronary', 'bypass', 'anjiyo', 'ritim bozukluğu'] },
    { name: 'Plastik ve Rekonstrüktif Cerrahi', keywords: ['estetik', 'burun', 'rhinoplasty', 'nose job', 'rinoplasti', 'plastik cerrahi', 'liposuction', 'meme estetiği', 'saç ekimi'] },
    { name: 'Organ Nakli Merkezi', keywords: ['nakil', 'karaciğer', 'böbrek', 'organ nakli', 'transplant', 'liver transplant', 'kidney transplant'] },
    { name: 'Beyin ve Sinir Cerrahisi', keywords: ['fıtık', 'fitik', 'bel fıtığı', 'boyun fıtığı', 'fıtığı', 'fıtıklar', 'beyin cerrahi', 'omurilik'] }
  ];

  /**
   * Evaluates if the latest user message represents a switch in topic compared to the active department.
   * If a switch is detected, it determines the new activeTopic and appends the old one to previousTopics.
   */
  public static resolve(
    latestInbound: string,
    currentDepartment: string | null,
    metadata?: any
  ): TopicSwitchResult {
    if (!latestInbound) {
      return { hasSwitched: false, activeTopic: currentDepartment, previousTopics: metadata?.previousTopics || [] };
    }

    const text = latestInbound.toLowerCase();
    
    // Find if the text matches any department keywords
    let matchedDept: string | null = null;
    for (const dept of this.DEPARTMENTS) {
      if (dept.keywords.some(kw => text.includes(kw))) {
        matchedDept = dept.name;
        break;
      }
    }

    const previousTopics: string[] = Array.isArray(metadata?.previousTopics)
      ? [...metadata.previousTopics]
      : [];

    if (currentDepartment && !previousTopics.includes(currentDepartment)) {
      previousTopics.push(currentDepartment);
    }

    if (matchedDept && currentDepartment && matchedDept !== currentDepartment) {
      // Topic switched! Remove duplicate activeTopic from previousTopics
      const filteredPrev = previousTopics.filter(t => t !== matchedDept);
      
      return {
        hasSwitched: true,
        activeTopic: matchedDept,
        previousTopics: filteredPrev
      };
    }

    return {
      hasSwitched: false,
      activeTopic: currentDepartment,
      previousTopics
    };
  }
}
