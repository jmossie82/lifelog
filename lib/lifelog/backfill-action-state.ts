export type BackfillActionState = {
  status: "idle" | "success" | "error";
  message: string;
  importedCount: number | null;
};

export const initialBackfillActionState: BackfillActionState = {
  status: "idle",
  message: "",
  importedCount: null,
};
