export type AdminReadState<T> =
  | { status: "ready"; data: T }
  | {
      status: "unavailable" | "error" | "missing";
      message: string;
      code?: "ADMIN_ACCESS_REQUIRED" | "ACTOR_NOT_ACTIVE";
    };
