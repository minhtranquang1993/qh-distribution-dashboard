/** Raw CSV row shape, keyed by the source file's own column names. */
export interface RawRow {
  submission_id?: string;
  submission_date?: string;
  URL?: string;
  first_source_url?: string;
  first_user_source?: string;
  first_user_medium?: string;
  location?: string;
  'top-brands-you-are-looking-for'?: string;
  'estimated-monthly-amount-dollar-you-wish-to-buy-from-us'?: string;
  'in-which-country-is-your-business-registered'?: string;
  'country-to-distribute-products'?: string;
  'type-company'?: string;
  'how-do-you-know-about-us'?: string;
  Company?: string;
  Name?: string;
  Email?: string;
  'calling-code'?: string;
  Phone?: string;
  'preferred-method-of-contact'?: string;
  'your-type-of-business-or-the-website'?: string;
  'g-recaptcha-response'?: string;
  Week?: string;
  Month?: string;
  Day?: string;
}
