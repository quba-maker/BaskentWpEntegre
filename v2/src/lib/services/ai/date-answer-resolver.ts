export class DateAnswerResolver {
  private static MONTHS_TR = [
    { index: 0, names: ['ocak'] },
    { index: 1, names: ['subat', 'şubat'] },
    { index: 2, names: ['mart'] },
    { index: 3, names: ['nisan'] },
    { index: 4, names: ['mayis', 'mayıs'] },
    { index: 5, names: ['haziran'] },
    { index: 6, names: ['temmuz'] },
    { index: 7, names: ['agustos', 'ağustos'] },
    { index: 8, names: ['eylul', 'eylül'] },
    { index: 9, names: ['ekim'] },
    { index: 10, names: ['kasim', 'kasım'] },
    { index: 11, names: ['aralik', 'aralık'] }
  ];

  private static MONTH_NAMES_CAPITALIZED = [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
  ];

  public static isAmbiguousNumericDateReply(text: string): { ambiguous: boolean; raw: string; monthDayLabel?: string; rangeLabel?: string } {
    if (!text) return { ambiguous: false, raw: '' };
    const clean = text.toLowerCase().trim();
    const match = clean.match(/^\s*(\d{1,2})\s*([./\s])\s*(\d{1,2})\s*$/);
    if (!match) return { ambiguous: false, raw: text.trim() };

    const first = parseInt(match[1], 10);
    const second = parseInt(match[3], 10);
    const raw = text.trim();
    if (first >= 1 && first <= 12 && second >= 13 && second <= 31) {
      return {
        ambiguous: true,
        raw,
        monthDayLabel: `${second} ${this.MONTH_NAMES_CAPITALIZED[first - 1]}`,
        rangeLabel: `${first}-${second} ${this.MONTH_NAMES_CAPITALIZED[first - 1]} arası`
      };
    }
    return { ambiguous: false, raw };
  }

  /**
   * Parses Turkish date expressions, normalizes month names, resolves year based on timezone,
   * and prevents resolving to past dates.
   */
  public static parse(text: string, timezone: string = 'Europe/Istanbul'): { raw: string; date?: Date } {
    if (!text) return { raw: '' };
    const clean = text.toLowerCase().trim();
    
    // Get current date in tenant timezone
    let now = new Date();
    try {
      const tzDateStr = new Date().toLocaleString('en-US', { timeZone: timezone });
      now = new Date(tzDateStr);
    } catch (_) {}
    
    const currentYear = now.getFullYear();
    const currentMonthIdx = now.getMonth(); // 0-11

    // Numeric shorthand in arrival-date context:
    // "7 15" / "7/15" => 15 Temmuz (month-day, common for patients abroad)
    // "15 7" / "15/7" => 15 Temmuz (day-month, Turkish style)
    // Only accept unambiguous pairs so "13 30" is not treated as a date.
    const numericDateRegex = /^\s*(\d{1,2})\s*[./\s]\s*(\d{1,2})\s*$/;
    const numericDateMatch = clean.match(numericDateRegex);
    if (numericDateMatch) {
      const first = parseInt(numericDateMatch[1], 10);
      const second = parseInt(numericDateMatch[2], 10);
      let day: number | null = null;
      let monthIdx: number | null = null;

      if (first >= 1 && first <= 12 && second >= 13 && second <= 31) {
        monthIdx = first - 1;
        day = second;
      } else if (first >= 13 && first <= 31 && second >= 1 && second <= 12) {
        day = first;
        monthIdx = second - 1;
      }

      if (day !== null && monthIdx !== null) {
        let targetYear = currentYear;
        let parsedDate = new Date(targetYear, monthIdx, day);
        parsedDate.setHours(0, 0, 0, 0);

        const compareDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        if (parsedDate.getTime() < compareDate.getTime()) {
          targetYear += 1;
          parsedDate = new Date(targetYear, monthIdx, day);
        }

        return { raw: `${day} ${this.MONTH_NAMES_CAPITALIZED[monthIdx]}`, date: parsedDate };
      }
    }
    
    // 1. Check for intervals: "15-20 temmuz arası" -> "15-20 Temmuz"
    const intervalRegex = /(\d{1,2})\s*[-–—\/]\s*(\d{1,2})\s*([a-zçıüşöğ]+)/i;
    const intervalMatch = clean.match(intervalRegex);
    if (intervalMatch) {
      const startDay = parseInt(intervalMatch[1], 10);
      const endDay = parseInt(intervalMatch[2], 10);
      const monthName = intervalMatch[3];
      const monthObj = this.MONTHS_TR.find(m => m.names.some(n => monthName.includes(n) || n.includes(monthName)));
      if (monthObj) {
        const capitalizedMonth = this.MONTH_NAMES_CAPITALIZED[monthObj.index];
        return { raw: `${startDay}-${endDay} ${capitalizedMonth}` };
      }
    }

    // 3. Check for standalone "ay sonu" -> "Ay sonu"
    if (clean.includes('ay sonu') || clean.includes('ayın sonu')) {
      return { raw: 'Ay sonu' };
    }
    if (clean.includes('ay başı') || clean.includes('ay basi') || clean.includes('ayın başı')) {
      return { raw: 'Ay başı' };
    }

    // 2. Check for "temmuz başı" -> "Temmuz başı"
    const relativePartRegex = /([a-zçıüşöğ]+)\s*(basi|başı|sonu|ortasi|ortası)/i;
    const relativePartMatch = clean.match(relativePartRegex);
    if (relativePartMatch) {
      const monthName = relativePartMatch[1];
      const part = relativePartMatch[2].replace('basi', 'başı').replace('sonu', 'sonu').replace('ortasi', 'ortası');
      const monthObj = this.MONTHS_TR.find(m => m.names.some(n => n === monthName || n.startsWith(monthName)));
      if (monthObj) {
        const capitalizedMonth = this.MONTH_NAMES_CAPITALIZED[monthObj.index];
        const formattedPart = part === 'başı' ? 'başı' : (part === 'sonu' ? 'sonu' : 'ortası');
        return { raw: `${capitalizedMonth} ${formattedPart}` };
      }
    }

    // 4. Check for "önümüzdeki ayın 10'u" -> next month, day 10
    const nextMonthDayRegex = /(?:onumuzdeki|önümüzdeki)\s*(?:ayin|ayın)\s*(\d{1,2})/i;
    const nextMonthDayMatch = clean.match(nextMonthDayRegex);
    if (nextMonthDayMatch) {
      const day = parseInt(nextMonthDayMatch[1], 10);
      const nextMonthIdx = (currentMonthIdx + 1) % 12;
      const targetYear = currentMonthIdx === 11 ? currentYear + 1 : currentYear;
      const capitalizedMonth = this.MONTH_NAMES_CAPITALIZED[nextMonthIdx];
      
      const parsedDate = new Date(targetYear, nextMonthIdx, day);
      return { raw: `${day} ${capitalizedMonth}`, date: parsedDate };
    }

    // 5. Check for "10 temmuz" or "temmuzun 10'u"
    const monthFirstRegex = /([a-zçıüşöğ]+)(?:un|un|in|ın|nun|nın)?\s*(\d{1,2})/i;
    const dayFirstRegex = /(\d{1,2})\s*([a-zçıüşöğ]+)/i;
    
    let day: number | null = null;
    let monthName: string | null = null;

    const dayFirstMatch = clean.match(dayFirstRegex);
    const monthFirstMatch = clean.match(monthFirstRegex);

    if (dayFirstMatch) {
      day = parseInt(dayFirstMatch[1], 10);
      monthName = dayFirstMatch[2];
    } else if (monthFirstMatch) {
      monthName = monthFirstMatch[1];
      day = parseInt(monthFirstMatch[2], 10);
    }

    if (day !== null && monthName) {
      const monthObj = this.MONTHS_TR.find(m => m.names.some(n => n === monthName || n.startsWith(monthName!)));
      if (monthObj) {
        const capitalizedMonth = this.MONTH_NAMES_CAPITALIZED[monthObj.index];
        let targetYear = currentYear;
        let tempDate = new Date(targetYear, monthObj.index, day);
        tempDate.setHours(0, 0, 0, 0);
        
        const compareDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        
        // Prevent past dates!
        if (tempDate.getTime() < compareDate.getTime()) {
          targetYear += 1;
          tempDate = new Date(targetYear, monthObj.index, day);
        }

        return { raw: `${day} ${capitalizedMonth}`, date: tempDate };
      }
    }

    // Fallback: capitalize first letter of each word
    const capitalized = text.trim()
      .split(/\s+/)
      .map(word => {
        if (!word) return '';
        const first = word.charAt(0);
        const upper = first === 'i' ? 'İ' : (first === 'ı' ? 'I' : first.toUpperCase());
        return upper + word.slice(1);
      })
      .join(' ');

    return { raw: capitalized };
  }
}
