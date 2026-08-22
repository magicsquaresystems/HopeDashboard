/**
 * What the drafting model is given to reply to.
 *
 * The platform serialises a goal as one string, built from the form's
 * sub-fields by a fixed template —
 *
 *     "{goal} on {when} . I will aim to do this {frequency}"
 *
 * — and then truncates the whole thing at 255 characters, an old column
 * limit. The model therefore received the goal stated twice (the
 * participant writes their frequency into the goal box, then the form
 * appends it again), a stray " on ", and a sentence cut off mid-word.
 * It answered garble with a generic pleasantry: "I'm sure it'll be
 * worth all the effort you've put into training up to it" against a
 * goal about walking to the end of the road.
 *
 * The sub-fields are not sent separately — the raw record carries only
 * `description` — so the only place to recover a readable post is here.
 * The template boundary is recognisable, and everything before it is
 * the participant's own words, complete and in their own order.
 *
 * Display is untouched: the timeline and the "Participant post" card
 * still show exactly what the platform holds, because a facilitator
 * reading someone's record should see the record. This changes only
 * what the model is asked to reply to.
 */

/** The platform's template seam between the goal box and the appended fields. */
const GOAL_TEMPLATE_SEAM = /\s+on\s+[\s\S]*?\.\s*I will aim to do this\b/;

/** A trailing fragment left by the 255-character cut: no closing
 *  punctuation and the last "word" bitten off. */
const TRAILING_FRAGMENT = /\s+\S*$/;

export function postTextForModel(
    activityType: string | null | undefined,
    description: string,
): string {
    const text = description.trim();
    if (activityType !== "GoalSetting") return text;

    const seam = text.search(GOAL_TEMPLATE_SEAM);
    if (seam > 0) {
        // Everything before the seam is the goal box, verbatim.
        return text.slice(0, seam).trim();
    }

    // No seam found but the text hit the platform's limit: it was cut
    // mid-field. Drop the bitten-off word rather than feed a stub like
    // "and I'll build" as if it were a sentence.
    if (text.length >= 255 && !/[.!?…]$/.test(text)) {
        return text.replace(TRAILING_FRAGMENT, "").trim() + "…";
    }
    return text;
}
