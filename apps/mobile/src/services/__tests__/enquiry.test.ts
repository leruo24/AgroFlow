/// <reference types="jest" />
// See doubleSubmit.test.ts for why this reference is per file.

/* Item 6c: "Ask for a call" from the login screen - no login, one request
 * per tap, the honeypot always empty, and the server's reason shown. */

jest.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));

process.env.EXPO_PUBLIC_AGROFLOW_API_BASE = 'https://api.agroflow.test';

import { submitEnquiry, type EnquiryInput } from '../agroFlowApi';
import { enquiryProblem } from '@/lib/enquiryForm';

const input: EnquiryInput = {
  fullName: 'Thandi Nkosi', phone: '082 123 4567', email: null, province: 'Western Cape', town: 'Ceres',
  farmSizeHa: 2, crops: ['potato'], cropsOther: null, bestTime: 'morning', notes: null, consent: true,
};

describe('submitEnquiry', () => {
  let original: typeof fetch;
  beforeEach(() => { original = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = original; });

  it('sends no login, an empty honeypot, and one request for a double tap', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify({ message: 'Thank you, a representative will call you within 2 working days.' }), { status: 200 });
    }) as unknown as typeof fetch;

    const [a, b] = await Promise.all([submitEnquiry(input), submitEnquiry(input)]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.agroflow.test/api/public/enquiries');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ ...input, website: '' });
    expect(a.message).toBe('Thank you, a representative will call you within 2 working days.');
    expect(b).toBe(a);
  });

  it("shows the server's own reason", async () => {
    globalThis.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ error: 'Too many enquiries from this connection. Please try again in an hour.' }), { status: 429 })
    ) as unknown as typeof fetch;
    await expect(submitEnquiry({ ...input, town: 'Paarl' })).rejects.toThrow('Too many enquiries from this connection. Please try again in an hour.');
  });
});

describe('the form checks', () => {
  it('needs a name, an SA phone, province, town, a crop and the consent', () => {
    expect(enquiryProblem(input)).toBeNull();
    expect(enquiryProblem({ ...input, consent: false })).toBe('Please tick the box to agree that we may contact you about this enquiry.');
    expect(enquiryProblem({ ...input, phone: '+44 20 7946 0958' })).toMatch(/South African phone/);
    expect(enquiryProblem({ ...input, crops: [] })).toBe('Please choose at least one crop.');
    expect(enquiryProblem({ ...input, crops: ['other'] })).toBe('Please say which other crop.');
    expect(enquiryProblem({ ...input, province: '' })).toBe('Please choose your province.');
  });
});
