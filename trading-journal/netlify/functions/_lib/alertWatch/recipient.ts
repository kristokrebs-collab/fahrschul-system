/**
 * The recipient of the e-mail alarm: the address of the signed-in account, read from Supabase Auth by user id – never
 * stored in the settings, never hard-coded, never logged. An address that is not confirmed is not mailed (someone could
 * have signed up with a stranger's address).
 */
import { supabaseAdmin } from "../supabase";

export interface Recipient {
  email: string;
  confirmed: boolean;
}

/** The account's address, or `null` when it has none / cannot be read. */
export async function recipientOf(userId: string): Promise<Recipient | null> {
  try {
    const { data, error } = await supabaseAdmin().auth.admin.getUserById(userId);
    if (error || !data?.user) return null;
    const email = data.user.email?.trim();
    if (!email) return null;
    return { email, confirmed: !!(data.user.email_confirmed_at ?? data.user.confirmed_at) };
  } catch {
    return null;
  }
}
