# Country flag assets

These 4:3 SVGs are the subset of [flag-icons](https://github.com/lipis/flag-icons) used by `COUNTRY_DIAL_CODES`.

- Source revision: [`ac7e0eb3259eb62aa6100c435607e2fe03896a97`](https://github.com/lipis/flag-icons/tree/ac7e0eb3259eb62aa6100c435607e2fe03896a97/flags/4x3).
- License: MIT; see [LICENSE](./LICENSE).
- SVGs are unchanged from upstream and bundled by Vite. No third-party image requests are needed, and flags do not depend on OS emoji support.
- When adding a supported country, add its lowercase ISO SVG from the pinned source (or deliberately update the source revision) and keep the license.

The selected flag is decorative: the native country control supplies the accessible country name and calling code. CountryFlag falls back to the Unicode flag if a local asset cannot load.
