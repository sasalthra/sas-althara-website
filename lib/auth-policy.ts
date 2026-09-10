export const ADMIN_EMAIL = 'sasalthra.sa@gmail.com';
export function allowedGoogleProfile(provider: string | undefined, profile: {email?: string; email_verified?: boolean; sub?: string} | undefined) {
  return provider === 'google' && profile?.email_verified === true &&
    profile.email?.trim().toLowerCase() === ADMIN_EMAIL &&
    typeof profile.sub === 'string' && profile.sub.length > 0;
}
