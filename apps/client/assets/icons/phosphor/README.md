# Phosphor icons (vendored)

The Phosphor web font, **regular** and **fill** weights only, copied from the
`@phosphor-icons/web` npm package (`npm pack @phosphor-icons/web@2.1.2`, files
`src/regular` and `src/fill`). The package is **not** a dependency of the app.

- **Version:** 2.1.2
- **License:** MIT (`LICENSE` in this folder)
- **Formats shipped:** `woff2` (first) and `woff` (fallback); the `ttf`/`svg`
  entries were removed from the `@font-face` rules because Chromium does not
  need them and the files would only be packaged dead weight.
- **Fonts are referenced by relative path** in each `style.css`.

| File | SHA-256 |
|---|---|
| `regular/Phosphor.woff2` | `c2ea45ea05ff5c7df1936770c104725f2a68f43fd343f35f3da23a30b27de32a` |
| `regular/Phosphor.woff` | `396c5eae7f2dfb4d1f5432edd87109eda2f92a451b2167e43a26165b82770f75` |
| `fill/Phosphor-Fill.woff2` | `660bd6045c0e0d9756cddb8ba2ece3aad855df7d4a170ef23f7b1c0bf511c430` |
| `fill/Phosphor-Fill.woff` | `5dea68e9198122686ec2788f81e345cd50c2ee9980f6c907d742f91cad481d48` |

## Usage

```html
<i class="ph ph-bell-slash" aria-hidden="true"></i>        <!-- regular -->
<i class="ph-fill ph-bell-slash" aria-hidden="true"></i>   <!-- fill -->
```

`.ph` / `.ph-fill` only set the icon font on the icon element itself; they do
not touch body text, so the emoji font stays first for text.
