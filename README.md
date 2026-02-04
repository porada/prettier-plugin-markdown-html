<p align="center">
    <a href="https://github.com/porada/prettier-plugin-markdown-html">
        <picture>
            <source
                srcset="https://github.com/porada/prettier-plugin-markdown-html/blob/main/assets/prettier-plugin-markdown-html-dark-scheme@3x.png?raw=true"
                media="(prefers-color-scheme: dark)"
            />
            <source
                srcset="https://github.com/porada/prettier-plugin-markdown-html/blob/main/assets/prettier-plugin-markdown-html-light-scheme@3x.png?raw=true"
                media="(prefers-color-scheme: light)"
            />
            <img
                src="https://github.com/porada/prettier-plugin-markdown-html/blob/main/assets/prettier-plugin-markdown-html-light-scheme@3x.png?raw=true"
                width="520"
                alt=""
            />
        </picture>
    </a>
</p>

<h1 align="center">prettier-plugin-markdown&#8209;html</h1>

<p align="center">Format raw HTML in&nbsp;Markdown with&nbsp;Prettier.</p>

<p align="center">
    <a href="https://www.npmjs.com/package/prettier-plugin-markdown-html"
        ><img
            src="https://img.shields.io/npm/v/prettier-plugin-markdown-html"
            alt=""
    /></a>
    <a href="https://github.com/porada/prettier-plugin-markdown-html/actions/workflows/test.yaml"
        ><img
            src="https://img.shields.io/github/actions/workflow/status/porada/prettier-plugin-markdown-html/test.yaml"
            alt=""
    /></a>
    <a href="https://codecov.io/github/porada/prettier-plugin-markdown-html"
        ><img
            src="https://img.shields.io/codecov/c/github/porada/prettier-plugin-markdown-html"
            alt=""
    /></a>
</p>

<div>&nbsp;</div>

## Overview

This plugin adds an extra level of consistency to Markdown files by formatting raw HTML fragments.

- Works with `README.md` and any other GitHub-flavored Markdown document.
- Respects Prettier’s built-in HTML options.
- Comes without any additional dependencies.

## Install

```sh
npm install --save-dev prettier-plugin-markdown-html
```

```sh
pnpm add --save-dev prettier-plugin-markdown-html
```

## Usage

Reference `prettier-plugin-markdown-html` in your [Prettier config](https://prettier.io/docs/configuration):

```json
{
    "plugins": [
        "prettier-plugin-markdown-html"
    ]
}
```

## Options

In addition to Prettier’s [built-in options](https://prettier.io/docs/options) that affect HTML formatting, `prettier-plugin-markdown-html` offers additional configuration options.

```ts
interface PluginOptions {
    /**
     * Override the preferred line length for raw HTML fragments in Markdown.
     * Unlike `printWidth`, this option does not affect code blocks or other
     * Markdown content. Falls back to `printWidth` when unset.
     * @default undefined
     */
    htmlFragmentPrintWidth?: number | undefined;
    /**
     * Enforce one HTML attribute per line for raw HTML fragments in Markdown.
     * Unlike `singleAttributePerLine`, this option does not affect code blocks.
     * Falls back to `singleAttributePerLine` when unset.
     * @default undefined
     */
    htmlFragmentSingleAttributePerLine?: boolean | undefined;
    /**
     * Control whitespace handling for raw HTML fragments in Markdown. Unlike
     * `htmlWhitespaceSensitivity`, this option does not affect code blocks.
     * Falls back to `htmlWhitespaceSensitivity` when unset.
     * @default undefined
     */
    htmlFragmentWhitespaceSensitivity?: 'css' | 'strict' | 'ignore' | undefined;
}
```

## Related

- [**@standard-config/prettier**](https://github.com/standard-config/prettier)
- [**prettier-plugin-expand-json**](https://github.com/porada/prettier-plugin-expand-json)
- [**prettier-plugin-yaml**](https://github.com/porada/prettier-plugin-yaml)

## License

MIT © [Dom Porada](https://dom.engineering)
