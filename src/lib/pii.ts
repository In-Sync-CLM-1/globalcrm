/** Masks a phone number, keeping the last 3 digits: "+91 90000 29518" -> "+91 •••••• 518". */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  if (phone.includes("•")) return phone; // already masked by the database
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 3) return "•".repeat(digits.length);
  const cc = phone.trim().startsWith("+") && digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : "";
  return `${cc}${"•".repeat(Math.max(3, Math.min(digits.length, 10) - 3))} ${digits.slice(-3)}`;
}

/** Masks an email, keeping the first letter and the domain: "rahul@gmail.com" -> "r••••@gmail.com". */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  if (email.includes("•")) return email; // already masked by the database
  const [name, domain] = email.split("@");
  if (!domain) return "•".repeat(Math.min(email.length, 6));
  return `${name.slice(0, 1)}${"•".repeat(Math.max(3, Math.min(name.length - 1, 6)))}@${domain}`;
}
