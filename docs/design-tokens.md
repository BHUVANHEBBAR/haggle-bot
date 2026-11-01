# Design tokens and UI rules

Source of truth: `web/src/index.css` (CSS variables, light in `:root`, dark in `.dark`, exposed to Tailwind 4 through `@theme inline`). This page is the hand-off note for anyone changing the UI.

## Colour roles (not hex values: use the role)
| Role | Token | Used for |
|---|---|---|
| Page / surface | `bg`, `card` | page background, cards, dialogs |
| Text | `ink`, `mute` | body text, secondary text (both meet WCAG AA on `bg` and `card`) |
| Lines | `line` | borders, dividers |
| Brand | `brand`, `brand-hover`, `brand-ink`, `brand-soft` | primary buttons, links, active tab, progress |
| Header | `navy`, `navy-ink`, `navy-mute` | the top bar |
| Status | `ok`, `warn`, `bad`, `accent` and their `-soft` backgrounds | paid, held/invoiced, errors, call-to-action orange |
| Neutral chip | `chip` | ghost buttons, pills, hover |

Rule: never use a raw hex in a component. Add a role here first. The dark theme must be added at the same time (`axe` runs in both).

## Type, space, shape
- Font: Inter Variable. Page title `clamp(26px, 5vw, 38px)` extrabold; section title `text-xl` semibold; body 16px; helper text 13px `mute`.
- Space: 4px grid through Tailwind (`gap-2`, `p-4`...). Page gutter 16px; content max width 1120px.
- Shape and depth: cards `rounded-2xl` + `shadow-card`; controls `rounded-xl`; pills `rounded-full`.

## Interaction rules
- **Targets** at least 44px high (`min-h-11`) for anything tappable.
- **Focus**: one visible `:focus-visible` ring everywhere; a skip link is the first tab stop.
- **Errors** are announced (`role="alert"`) and sit next to the field; loading uses `role="status"`.
- **Motion** respects `prefers-reduced-motion`.
- **States**: use `EmptyState`, `ErrorState`, `Skeleton`, `NotFound` from `components/states.tsx`; do not hand-roll new ones.
- **Dialogs** are native `<dialog>` (focus trap and Esc for free).

## Two products, two shells
| | Buyer storefront | Seller console |
|---|---|---|
| Routes | `/`, `/order/:id`, `/orders` | `/seller` (tabs in `?tab=`) |
| Header | shop nav, account chip, Developers menu | console label, "View shop as a buyer" |
| Sign-in | optional, email + one-time code (demo: shown on screen) | `SELLER_KEY`, 8 h session cookie, lockout after 5 wrong keys |

## Checks that guard this
`node scripts/e2e/a11y.js` (axe-core WCAG 2.1 A/AA, light and dark, every page and every seller tab) and the 375px overflow flow `y` in `scripts/e2e/run.js`.
