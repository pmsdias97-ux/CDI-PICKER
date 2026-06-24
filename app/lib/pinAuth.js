import { safeEqual } from "./apiGuards";

// Verificação do código de 3 dígitos com BLOQUEIO POR CONTA (independente do IP).
// Como o PIN tem só 1000 combinações, limitamos as tentativas por membro:
// ao fim de MAX_FAILS falhas, a conta fica bloqueada LOCK_MS. Fail-closed: sem
// código definido => sem acesso. Requer colunas member_pins.failed_attempts e
// member_pins.locked_until (supabase/pin-lockout.sql).
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

// Devolve: 'ok' | 'bad' | 'locked' | 'nopin'
export async function verifyMemberPin(supabase, userId, pin) {
  const { data: row } = await supabase
    .from("member_pins")
    .select("pin, failed_attempts, locked_until")
    .eq("user_id", userId)
    .maybeSingle();

  if (!row?.pin) return "nopin"; // fail-closed: conta sem código não é acessível

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return "locked";
  }

  if (safeEqual(row.pin, pin)) {
    if (row.failed_attempts || row.locked_until) {
      await supabase.from("member_pins")
        .update({ failed_attempts: 0, locked_until: null })
        .eq("user_id", userId);
    }
    return "ok";
  }

  const next = (row.failed_attempts || 0) + 1;
  if (next >= MAX_FAILS) {
    await supabase.from("member_pins")
      .update({ failed_attempts: 0, locked_until: new Date(Date.now() + LOCK_MS).toISOString() })
      .eq("user_id", userId);
    return "locked";
  }
  await supabase.from("member_pins").update({ failed_attempts: next }).eq("user_id", userId);
  return "bad";
}
