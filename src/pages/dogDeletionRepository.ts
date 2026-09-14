import { supabase } from "../lib/supabase";

export async function deleteDog(id: string): Promise<void> {
  // DELETE RLS remains admin-only. FK enforcement is atomic, including concurrent references.
  const { data, error } = await supabase.from("dogs").delete().eq("id", id).select("id").maybeSingle();
  if (error?.code === "23503") {
    throw new Error("연결된 이용 기록이 있는 반려견은 삭제할 수 없습니다.");
  }
  if (error?.code === "42501" || (!error && !data)) {
    throw new Error("삭제 권한이 없거나 이미 삭제된 반려견입니다. 목록을 새로고침해 주세요.");
  }
  if (error) throw new Error("반려견을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}
