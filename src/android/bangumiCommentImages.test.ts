import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BangumiCommentBody, { splitBangumiImages } from "./BangumiCommentBody";

describe("Bangumi sent images", () => {
  it("preserves body order and supports real sized, external, and protocol-relative image tags", () => {
    expect(splitBangumiImages("before [IMG=176,99] \n//lain.bgm.tv/a.jpg \n[/IMG] middle [img]https://i.postimg.cc/b.png[/img] after")).toEqual([
      { value: "before ", image: false }, { value: "https://lain.bgm.tv/a.jpg", image: true },
      { value: " middle ", image: false }, { value: "https://i.postimg.cc/b.png", image: true }, { value: " after", image: false },
    ]);
    expect(splitBangumiImages("[img]http://lain.bgm.tv/a.jpg[/img]")[0]?.value).toBe("https://lain.bgm.tv/a.jpg");
  });
  it("does not turn unrelated URLs, local files, or HTML into remote images", () => {
    const source = 'https://example.org/a.png [img]file:///secret[/img] <img src="https://example.org/injected.png">';
    expect(splitBangumiImages(source)).toEqual([{ value: source, image: false }]);
    const html = renderToStaticMarkup(createElement(BangumiCommentBody, { value: source }));
    expect(html).not.toContain('<img src=');
    expect(html).toContain("&lt;img");
  });
  it("bounds decoded pictures and keeps excess markup visible", () => {
    const tag = "[img]https://i.imgur.com/GKb6x3l.png[/img]";
    const parts = splitBangumiImages(tag.repeat(8));
    expect(parts.filter(part => part.image)).toHaveLength(4);
    expect(parts.at(-1)).toEqual({ value: tag.repeat(4), image: false });
    const html = renderToStaticMarkup(createElement(BangumiCommentBody, { value: tag }));
    expect(html).toContain("图片加载中");
    expect(html).not.toContain('<img src=');
  });
});
