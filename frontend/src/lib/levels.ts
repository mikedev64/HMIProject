export function levelRank(level?: string): number {
        switch (level) {
                case "admin":
                        return 3;
                case "operator":
                        return 2;
                case "viewer":
                        return 1;
                default:
                        return 0;
        }
}

export const OPERATOR_RANK = 2;
export const ADMIN_RANK = 3;

export function levelLabel(level?: string): string {
        switch (level) {
                case "admin":
                        return "Administrador";
                case "operator":
                        return "Operador";
                case "viewer":
                        return "Consulta";
                default:
                        return level ?? "—";
        }
}

export function errorMessage(e: unknown): string {
        if (e instanceof Error) return e.message;
        if (typeof e === "string") return e;
        const any = e as { message?: unknown };
        if (any && typeof any.message === "string") return any.message;
        return String(e);
}
