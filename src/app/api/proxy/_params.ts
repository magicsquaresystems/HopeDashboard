import { ApiError } from "@/lib/api/client";

/**
 * Required numeric parameters from a query string.
 *
 * Exists because `Number(null)` is `0`, not `NaN`. Every "is this a
 * number?" check built on `Number.isFinite` or `Number.isSafeInteger`
 * therefore passes an ABSENT parameter as the number zero — so a request
 * with no `cohortId` at all reached the cohort access check asking about
 * cohort 0, rather than being refused for saying nothing. It was caught
 * by probing the conversation route with the parameter left off, and the
 * memory route had the same shape.
 *
 * Nothing downstream was exploitable — no facilitator is assigned a
 * cohort 0, so the access check refused it — but the safety came from a
 * coincidence about the data rather than from the validation, and that is
 * not a property to rely on. Absence is now checked before conversion.
 */
export function requiredId(
    params: URLSearchParams,
    name: string,
): number {
    const raw = params.get(name);
    if (raw === null || raw.trim() === "") {
        throw new ApiError(400, `${name} is required`, "invalid_request");
    }
    const value = Number(raw);
    // Zero and negatives are refused alongside NaN: the platform issues
    // neither, so either means the caller is confused about what it is
    // asking for.
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new ApiError(
            400,
            `${name} must be a positive id`,
            "invalid_request",
        );
    }
    return value;
}
