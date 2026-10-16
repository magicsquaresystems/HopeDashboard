import type { Draft } from "@/lib/api/commentGen";

/** A card's clipboard adoption and confirmed publication have separate lifetimes. */
export function createDraftRecorder() {
    let copied = false;
    let published = false;
    return {
        copy(id: string, record?: (id: string) => void) {
            if (copied) return;
            record?.(id);
            copied = true;
        },
        publish(id: string, text: string, action: "accept" | "edit",
            record: (id: string, text: string, action: "accept" | "edit") => void) {
            if (published) return;
            record(id, text, action);
            published = true;
        },
    };
}

export function currentGrounding(draft: Pick<Draft, "body" | "grounding">, text: string) {
    return text === draft.body ? draft.grounding : "unchecked";
}

export function publicationStatus(result: { status?: string } | undefined) {
    if (result?.status !== "published" && result?.status !== "dry_run") {
        throw new Error("The platform did not confirm publication. Check Hope before retrying.");
    }
    return result.status;
}
