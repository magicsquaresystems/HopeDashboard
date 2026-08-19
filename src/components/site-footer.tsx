/**
 * The Hope For The Community credit, mirroring the platform's own
 * footer so the dashboard reads as part of the same family. Text-only
 * until the org supplies a logo asset; the link target is their public
 * site, same as the platform footer links to.
 */
export function SiteFooter() {
    return (
        <footer className="mt-auto border-t border-border bg-surface px-4 py-3 text-center text-xs text-muted">
            Powered by{" "}
            <a
                href="https://www.h4c.org.uk/"
                target="_blank"
                rel="noreferrer"
                className="text-text-2 transition-colors hover:text-text"
            >
                Hope For The Community
            </a>
        </footer>
    );
}
