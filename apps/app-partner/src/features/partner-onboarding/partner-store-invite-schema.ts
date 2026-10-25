import { z } from "zod";

// Client feedback only. DSH remains the final authority for invitation eligibility.
export const inviteDetailsSchema = z.object({
  phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "رقم الهاتف يجب أن يكون بالصيغة الدولية"),
  displayName: z.string().trim().min(1).max(200),
});

export type InviteDetails = z.infer<typeof inviteDetailsSchema>;
