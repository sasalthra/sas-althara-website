/**
 * Public office mobile. Contact page, header, footer, property call links,
 * and the WhatsApp button all read this value.
 */
export const OFFICE_PHONE_E164 = '+966563000556';

const officeLocal = `0${OFFICE_PHONE_E164.slice(4)}`;

/** Local grouping shown on the site: 056 300 0556 */
export const OFFICE_PHONE_DISPLAY = `${officeLocal.slice(0, 3)} ${officeLocal.slice(3, 6)} ${officeLocal.slice(6)}`;

export const OFFICE_PHONE_TEL = `tel:${OFFICE_PHONE_E164}`;
export const OFFICE_WHATSAPP_URL = `https://wa.me/${OFFICE_PHONE_E164.slice(1)}`;

export const OFFICE_EMAIL = 'info@sasalthra.sa';

/** Short link that opens the office pin in Google Maps. */
export const OFFICE_MAPS_URL = 'https://maps.app.goo.gl/ypD7EkSxMdmjJCxb8';

/**
 * Map embed for the same office (21.8157735, 39.079169).
 * The classic Maps embed URL does not need an API key.
 */
export const OFFICE_MAP_EMBED_URL =
  'https://www.google.com/maps/embed?origin=mfe&pb=!1m3!2m1!1s21.8157735,39.079169!6i16';
