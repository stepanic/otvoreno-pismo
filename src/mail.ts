import type { Env } from "./env";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Zadnji poslani mailovi u načinu "log" (za lokalni razvoj i testove). */
export const outbox: Mail[] = [];

export async function sendMail(env: Env, mail: Mail): Promise<void> {
  if (env.MAIL_MODE === "resend") {
    if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY nije postavljen");
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
    return;
  }
  outbox.push(mail);
  if (outbox.length > 50) outbox.shift();
  console.log(`[mail] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
}
