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

- Works with `README.md` and any other Markdown document rendered on GitHub.
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

## Related

- [**@standard-config/prettier**](https://github.com/standard-config/prettier)
- [**prettier-plugin-expand-json**](https://github.com/porada/prettier-plugin-expand-json)
- [**prettier-plugin-yaml**](https://github.com/porada/prettier-plugin-yaml)

## License

MIT © [Dom Porada](https://dom.engineering)
