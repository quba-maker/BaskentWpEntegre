import { isNonCompliant, sanitizeGreeting } from '../src/lib/utils/patient-message-sanitizer';

const text = "Merhaba, Başkent Üniversitesi Konya Hastanesi’nden, doldurduğunuz form doğrultusunda sizinle iletişime geçiyoruz.";

console.log("Is non compliant:", isNonCompliant(text));
console.log("sanitizeGreeting:", sanitizeGreeting(text));
