/* The "Ask for a call" form's lists and checks, in the server's own words, so a person is
 * told straight away; the server checks again. */
import type { EnquiryInput } from '@/services/agroFlowApi';
import { phoneProblem } from '@/lib/phone';

export const PROVINCES = [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
  'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape',
];

export const CONSENT_TEXT =
  'I agree that AgroFlow may contact me about this enquiry and store these details for that purpose.';

export const TIMES: EnquiryInput['bestTime'][] = ['morning', 'afternoon', 'evening'];

/** What a person should fix before sending, in the server's words. */
export function enquiryProblem(f: EnquiryInput): string | null {
  if (f.fullName.trim().length < 2) return 'Please give your full name.';
  // The same rule as the server (AF-20): 000 000 0000 is refused here, not after sending.
  const phone = phoneProblem(f.phone);
  if (phone) return phone;
  if (!f.province) return 'Please choose your province.';
  if (f.town.trim().length < 2) return 'Please give your town.';
  if (f.crops.length === 0) return 'Please choose at least one crop.';
  if (f.crops.includes('other') && !f.cropsOther?.trim()) return 'Please say which other crop.';
  if (!f.consent) return 'Please tick the box to agree that we may contact you about this enquiry.';
  return null;
}

