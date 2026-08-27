import { Badge } from '../../../components/ui/badge';
import { useLang } from '../../../i18n/LanguageContext';
import { AXIS_COPY } from '../copy/provider-verification-copy';
import type { VerificationAxes } from '../verification-view-state';

// Sprint 9B.11 — the five axes, shown as five separate things.
//
// docs/sprint-09b11/PROVIDER_VERIFICATION_EXPERIENCE.md
//
// WHY FIVE BADGES AND NOT ONE STATUS
//
// ADR 0005 keeps these on separate axes because they answer different
// questions, and a provider who cannot tell them apart draws the wrong
// conclusion from each:
//
//   finishing the sign-up form is not being verified;
//   being verified is not being allowed to work — a grant expires;
//   VIP is paid for and Featured is awarded, and NEITHER grants anything.
//
// A single "status" pill would have to pick one of these to show, and every
// choice is wrong for someone. The most damaging conflation is the last: a
// provider who believed VIP unlocked work would be paying for something it
// does not do, so the note under the badges says so in words.
//
// REUSED: `ui/badge` and its existing variants. No new visual language.

export interface VerificationAxisBadgesProps {
  axes: VerificationAxes;
}

export function VerificationAxisBadges({ axes }: VerificationAxisBadgesProps) {
  const { lang, dir } = useLang();
  const t = AXIS_COPY[lang];

  /** The three ACCESS axes. Order is deliberate: it is the order a provider
   *  passes through them, so the row reads as progress rather than as a set of
   *  unrelated flags. */
  const access: Array<{ key: keyof VerificationAxes; label: string }> = [
    { key: 'onboardingComplete', label: t.onboardingComplete },
    { key: 'identityVerified', label: t.identityVerified },
    { key: 'workAccessActive', label: t.workAccessActive },
  ];

  return (
    <section aria-label={t.heading} dir={dir} className="space-y-2">
      <h3 className="text-sm font-semibold">{t.heading}</h3>

      <ul className="flex flex-wrap gap-2" data-testid="verification-axes">
        {access.map(({ key, label }) => (
          <li key={key}>
            <Badge
              variant={axes[key] ? 'default' : 'secondary'}
              data-testid={`axis-${key}`}
              data-active={axes[key] ? 'true' : 'false'}
            >
              {/* The value is in the text, not only in the colour: a badge
                  whose only signal is hue says nothing to a screen reader and
                  little to someone who cannot distinguish it. */}
              {label} — {axes[key] ? t.yes : t.no}
            </Badge>
          </li>
        ))}
      </ul>

      {/* RECOGNITION, kept in its own row and its own words. Rendered only when
          held: an absent "VIP — Not yet" would read as something withheld from
          them, which is a sales message on a compliance screen. */}
      {(axes.vip || axes.featured) && (
        <>
          <ul className="flex flex-wrap gap-2" data-testid="verification-recognition">
            {axes.vip && (
              <li>
                <Badge variant="outline" data-testid="axis-vip">
                  {t.vip}
                </Badge>
              </li>
            )}
            {axes.featured && (
              <li>
                <Badge variant="outline" data-testid="axis-featured">
                  {t.featured}
                </Badge>
              </li>
            )}
          </ul>
          <p className="text-xs text-muted-foreground" data-testid="verification-badge-note">
            {t.badgeNote}
          </p>
        </>
      )}
    </section>
  );
}
