import { normalizeName, explicitPageDepartment, matchDepartments } from "./match-departments.mjs";

export function officialAttachments(html, config) {
  html = html.replace(/<!--[\s\S]*?-->/gu, "");
  const text = html.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ");
  for (const required of config.index_required_text) if (!normalizeName(text).includes(normalizeName(required))) throw Error("OFFICIAL_INDEX_SCOPE_CHANGED");
  if (config.adapter === "suwon-adopted-mixed-account-pdf") {
    if (new URL(config.index_url).origin !== "https://www.suwon.go.kr" || config.account_code !== "100" || config.account_name !== "일반회계" || config.expected_documents !== 1) throw Error("OFFICIAL_INDEX_SCOPE_CHANGED");
    const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].filter((row) => {
      const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/giu)].map((cell) => normalizeName(cell[1].replace(/<[^>]*>/gu, " ")));
      return cells[0] === config.fiscal_year && cells[1] === normalizeName("일반 · 특별회계") && cells[2] === normalizeName(config.attachment_label);
    });
    if (rows.length !== 1) throw Error("OFFICIAL_CORPUS_INCOMPLETE");
    const hrefs = [...rows[0][1].matchAll(/<a\b[^>]*href=["']([^"']+)["']/giu)].map((link) => new URL(link[1].replaceAll("&amp;", "&"), config.index_url));
    if (hrefs.length !== 1 || hrefs[0].href !== config.attachment_url || hrefs[0].origin !== new URL(config.index_url).origin) throw Error("OFFICIAL_ATTACHMENT_CHANGED");
    return [{ id: "adopted-mixed-account", url: hrefs[0].href, label: config.attachment_label, toc_names: [], toc_basis: "official_budget_organisation_statement", account_code: config.account_code, account_basis: "verified_pdf_account_chapter" }];
  }
  if (config.adapter === "official-labeled-li-index") {
    if (config.department_toc) {
      const links = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/giu)].filter((item) => {
        const label = item[1].match(/<span\b[^>]*>([\s\S]*?)<\/span>/iu)?.[1]?.replace(/<[^>]*>/gu, " ");
        const href = item[1].match(/<a\b[^>]*href=["']([^"']+)["']/iu)?.[1]?.replaceAll("&amp;", "&");
        return href && new URL(href, config.index_url).href === config.department_toc.url && normalizeName(label) === normalizeName(config.department_toc.label);
      });
      if (links.length !== 1 || new URL(config.department_toc.url).origin !== new URL(config.index_url).origin) throw Error("OFFICIAL_DEPARTMENT_TOC_MISSING");
    }
    const headings = [...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/giu)];
    const account = headings.findIndex((heading) => normalizeName(heading[1]) === normalizeName(config.account_section_label));
    if (account < 0) throw Error("ACCOUNT_SECTION_MISSING");
    const section = headings.findIndex((heading, index) => index > account && normalizeName(heading[1]) === normalizeName(config.document_section_label));
    const end = headings.findIndex((heading, index) => index > section && normalizeName(heading[1]) === normalizeName(config.account_end_label));
    if (section < 0 || end < 0 || headings.slice(account + 1, section).some((heading) => /^<h4\b/iu.test(heading[0]))) throw Error("ACCOUNT_SECTION_MISSING");
    const scope = html.slice(headings[section].index, headings[end].index), out = [];
    for (const item of scope.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/giu)) {
      const label = item[1].match(/<span\b[^>]*>([\s\S]*?)<\/span>/iu)?.[1]?.replace(/<[^>]*>/gu, " ").trim();
      const href = item[1].match(/<a\b[^>]*href=["']([^"']+)["']/iu)?.[1]?.replaceAll("&amp;", "&");
      if (!href) continue;
      const url = new URL(href, config.index_url), expected = config.attachments.find((candidate) => candidate.url === url.href);
      if (url.origin !== new URL(config.index_url).origin || !expected || normalizeName(label) !== normalizeName(expected.label)) throw Error("OFFICIAL_ATTACHMENT_CHANGED");
      out.push({ id: url.searchParams.get("fileSid"), url: url.href, label, toc_names: expected.toc_names.map(normalizeName), toc_basis: "official_publisher_attachment_index", account_code: config.account_code, account_basis: "official_index_general_account_section" });
    }
    if (out.length !== config.expected_documents || out.length !== config.attachments.length || new Set(out.map((item) => item.url)).size !== out.length || out.some((item) => !/^[0-9]+$/u.test(item.id ?? ""))) throw Error("OFFICIAL_CORPUS_INCOMPLETE");
    return out;
  }
  if (config.adapter === "official-single-general-pdf") {
    const out = [];
    for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)) {
      const accountHeading = row[1].match(/<th\b[^>]*>([\s\S]*?)<\/th>/iu)?.[1]?.replace(/<[^>]*>/gu, " ");
      if (normalizeName(accountHeading) !== normalizeName(config.account_row_label)) continue;
      for (const link of row[1].matchAll(/<a\b([^>]+)>([\s\S]*?)<\/a>/giu)) {
        const label = link[2].replace(/<[^>]*>/gu, " ").trim();
        if (normalizeName(label) !== normalizeName(config.attachment_label)) continue;
        const href = link[1].match(/href=["']([^"']+)["']/iu)?.[1]?.replaceAll("&amp;", "&");
        if (!href) throw Error("ATTACHMENT_URL_MISSING");
        const url = new URL(href, config.index_url);
        if (url.origin !== new URL(config.index_url).origin || url.href !== config.attachment_url) throw Error("ATTACHMENT_URL_CHANGED");
        out.push({ id: "general-account", url: url.href, label, toc_names: [], toc_basis: "official_budget_organisation_statement", account_code: config.account_code, account_basis: "official_index_general_account_section" });
      }
    }
    if (out.length !== 1 || config.expected_documents !== 1) throw Error("OFFICIAL_CORPUS_INCOMPLETE");
    const tocLink = [...html.matchAll(/<a\b([^>]+)>([\s\S]*?)<\/a>/giu)].filter((link) => {
      const href = link[1].match(/href=["']([^"']+)["']/iu)?.[1]?.replaceAll("&amp;", "&");
      return href && new URL(href, config.index_url).href === config.department_toc?.url && normalizeName(link[2].replace(/<[^>]*>/gu, " ")) === normalizeName(config.department_toc?.label);
    });
    if (tocLink.length !== 1 || new URL(config.department_toc.url).origin !== new URL(config.index_url).origin) throw Error("OFFICIAL_DEPARTMENT_TOC_MISSING");
    return out;
  }
  if (config.adapter === "seongnam-year-general-pdf") {
    if (new URL(config.index_url).origin !== "https://www.seongnam.go.kr" || !/<div\b[^>]*class=["'][^"']*\bbgt-pdf\b/iu.test(html)) throw Error("OFFICIAL_INDEX_SCOPE_CHANGED");
    const headings = [...html.matchAll(/<h([4-6])\b[^>]*>([\s\S]*?)<\/h[4-6]>/giu)];
    const yearHeadings = headings.filter((heading) => heading[1] === "4" && normalizeName(heading[2]) === normalizeName(config.year_section_label));
    if (yearHeadings.length !== 1) throw Error("OFFICIAL_YEAR_SECTION_CHANGED");
    const start = headings.indexOf(yearHeadings[0]), nextYear = headings.findIndex((heading, index) => index > start && heading[1] === "4");
    const scoped = headings.slice(start + 1, nextYear < 0 ? undefined : nextYear);
    const accounts = scoped.filter((heading) => heading[1] === "5" && normalizeName(heading[2]) === "일반회계");
    if (accounts.length !== 1) throw Error("ACCOUNT_SECTION_MISSING");
    const account = scoped.indexOf(accounts[0]), end = scoped.findIndex((heading, index) => index > account && heading[1] === "5");
    if (end < 0) throw Error("ACCOUNT_SECTION_MISSING");
    const statements = scoped.slice(account + 1, end).filter((heading) => heading[1] === "6" && normalizeName(heading[2]) === "세출예산사업명세서");
    if (statements.length !== 1) throw Error("ACCOUNT_SECTION_MISSING");
    const section = html.slice(statements[0].index, scoped[end].index);
    const yearIntro = html.slice(yearHeadings[0].index, accounts[0].index);
    const download = (scope, label, filename, url) => {
      const entries = [...scope.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/giu)].filter((item) => {
        const heading = item[1].match(/<p\b[^>]*>([\s\S]*?)<\/p>/iu)?.[1] ?? item[1].split(/<(?:span|a)\b/iu)[0];
        return normalizeName(heading.replace(/<[^>]*>/gu, " ")) === normalizeName(label);
      });
      if (entries.length !== 1 || !/^[0-9_]+\.pdf$/u.test(filename ?? "")) throw Error("OFFICIAL_CORPUS_INCOMPLETE");
      const links = [...entries[0][1].matchAll(/<a\b([^>]+)>([\s\S]*?)<\/a>/giu)].filter((link) => normalizeName(link[2].replace(/<[^>]*>/gu, " ")) === "다운로드");
      const onclick = links[0]?.[1].match(/onclick="([^"]+)"/iu)?.[1];
      const args = onclick?.match(/^javascript:fileDownload\('([^']+)','([^']+)','([^']+)'\);\s*return false;$/u);
      if (links.length !== 1 || !args || args[1] !== config.original_download_prefix || args[2] !== filename || args[3] !== filename || !/href=["']#download["']/iu.test(links[0][1])) throw Error("OFFICIAL_ATTACHMENT_CHANGED");
      if (url !== new URL("/humanframe/file/sncity/bgt/" + config.fiscal_year + "/" + filename, config.index_url).href) throw Error("ATTACHMENT_URL_CHANGED");
    };
    download(section, config.attachment_label, config.attachment_filename, config.attachment_url);
    download(yearIntro, config.department_toc.label, config.department_toc.filename, config.department_toc.url);
    if (config.expected_documents !== 1 || config.account_code !== "100" || config.account_name !== "일반회계" || config.original_download_prefix !== "/contents/down/budget/" + config.fiscal_year + "/") throw Error("OFFICIAL_INDEX_SCOPE_CHANGED");
    return [{ id: "general-account", url: config.attachment_url, label: config.attachment_label, toc_names: [], toc_basis: "official_budget_organisation_statement", account_code: config.account_code, account_basis: "official_index_general_account_section" }];
  }
  if (config.adapter === "hwaseong-budopen-form") {
    // 화성시 재정공시 「예산서 공개」: 연도별 표의 본예산 줄 「일반회계」 칸이 POST 양식(OpenDown)으로 받는 문서다.
    const form = config.download_form;
    if (new URL(config.index_url).origin !== "https://money.hscity.go.kr" || config.expected_documents !== 1 || config.account_code !== "100" || config.account_name !== "일반회계" || !config.pdf_account_scope || !/^\d+$/u.test(form?.mseq ?? "") || form.gubun !== "2-1") throw Error("OFFICIAL_INDEX_SCOPE_CHANGED");
    const headers = [...(html.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/iu)?.[1] ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/giu)].map((cell) => normalizeName(cell[1].replace(/<[^>]*>/gu, " ")));
    if (headers.join("|") !== "연도|예산구분|예산규모|일반회계|기타특별회계|공기업특별회계") throw Error("OFFICIAL_INDEX_SCOPE_CHANGED");
    let year = null; const rows = [];
    for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)) {
      const cells = [...row[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/giu)];
      if (cells[0] && /rowspan/iu.test(cells[0][1])) { year = normalizeName(cells[0][2].replace(/<[^>]*>/gu, " ")).replace(/년$/u, ""); cells.shift(); }
      const stage = cells[0]?.[2].match(/javascript:YeOpenView\('(\d+)'\);["']>([^<]+)</u);
      // After the rowspan year cell: 예산구분, 예산규모, 일반회계, … (일반회계 is the third remaining cell).
      if (year === config.fiscal_year && stage && normalizeName(stage[2]) === "본예산") rows.push({ mseq: stage[1], general: cells[2]?.[2] ?? "" });
    }
    if (rows.length !== 1 || rows[0].mseq !== form.mseq || !rows[0].general.includes("javascript:OpenDown('" + form.mseq + "','" + form.gubun + "');")) throw Error("OFFICIAL_ATTACHMENT_CHANGED");
    const formHtml = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/giu)].filter((f) => /name=["']OpenDown["']/iu.test(f[1]));
    const action = formHtml[0]?.[1].match(/action=["']([^"']+)["']/iu)?.[1];
    if (formHtml.length !== 1 || !/method=["']post["']/iu.test(formHtml[0][1]) || !action || new URL(action, config.index_url).href !== config.attachment_url || !formHtml[0][2].includes('name="' + form.csrf_field + '"')) throw Error("OFFICIAL_ATTACHMENT_CHANGED");
    if (config.department_toc && config.department_toc.url !== config.attachment_url) throw Error("OFFICIAL_DEPARTMENT_TOC_MISSING");
    return [{ id: "general-account", url: config.attachment_url, label: config.attachment_label, toc_names: [], toc_basis: "official_budget_organisation_statement", account_code: config.account_code, account_basis: "verified_pdf_account_chapter" }];
  }
  if (config.adapter === "bucheon-adopted-link-list") {
    const origin = new URL(config.index_url).origin;
    if (origin !== "https://budget.bucheon.go.kr" || config.expected_documents !== 1 || config.account_code !== "100" || config.account_name !== "일반회계") throw Error("OFFICIAL_INDEX_SCOPE_CHANGED");
    const menu = new URL(config.index_url).searchParams.get("menuid");
    const activeYear = [...html.matchAll(/<li\b[^>]*class=["'][^"']*\bon\b[^"']*["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*<span>\s*(\d{4})\s*<\/span>/giu)];
    if (activeYear.length !== 1 || activeYear[0][2] !== config.fiscal_year || new URL(activeYear[0][1].replaceAll("&amp;", "&"), config.index_url).searchParams.get("menuid") !== menu) throw Error("OFFICIAL_YEAR_SECTION_CHANGED");
    const stageTab = html.match(/<nav\b[^>]*class=["'][^"']*\btab_ty02\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/iu)?.[1] ?? "";
    const activeStage = [...stageTab.matchAll(/<li\b[^>]*class=["'][^"']*\bon\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/giu)].map((item) => normalizeName(item[1].replace(/<[^>]*>/gu, " ")));
    if (activeStage.length !== 1 || activeStage[0] !== "본예산") throw Error("OFFICIAL_STAGE_CHANGED");
    const headings = [...html.matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4>/giu)];
    const section = headings.findIndex((heading) => normalizeName(heading[1].replace(/<[^>]*>/gu, " ")) === normalizeName(config.account_section_label));
    if (section < 0 || !headings[section + 1]) throw Error("ACCOUNT_SECTION_MISSING");
    const scope = html.slice(headings[section].index, headings[section + 1].index);
    const linkFor = (label, expectedUrl) => {
      const items = [...scope.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/giu)].filter((item) => normalizeName(item[1].split(/<span\b/iu)[0].replace(/<[^>]*>/gu, " ")) === normalizeName(label));
      if (items.length !== 1) throw Error("OFFICIAL_CORPUS_INCOMPLETE");
      const hrefs = [...items[0][1].matchAll(/<a\b[^>]*href=["']([^"']+)["']/giu)].map((link) => new URL(link[1].replaceAll("&amp;", "&"), config.index_url));
      if (hrefs.length !== 1 || hrefs[0].origin !== origin || hrefs[0].href !== expectedUrl || !hrefs[0].pathname.startsWith("/docs/budget/depth1_1/" + config.fiscal_year + "/")) throw Error("OFFICIAL_ATTACHMENT_CHANGED");
    };
    linkFor(config.attachment_label, config.attachment_url);
    linkFor(config.department_toc.label, config.department_toc.url);
    return [{ id: "general-account", url: config.attachment_url, label: config.attachment_label, toc_names: [], toc_basis: "official_budget_organisation_statement", account_code: config.account_code, account_basis: "official_index_general_account_section" }];
  }
  if (config.adapter !== "yongin-official-attachment-index") throw Error("UNSUPPORTED_PUBLISHER_ADAPTER");
  const headings = [...html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/giu)];
  const section = headings.findIndex((m) => normalizeName(m[1]).includes("세출예산사업명세서(일반회계)"));
  if (section < 0 || !headings[section + 1]) throw Error("ACCOUNT_SECTION_MISSING");
  const sectionStart = headings[section].index, sectionEnd = headings[section + 1].index;
  const out = [];
  for (const match of html.matchAll(/<a\b([^>]+)>([\s\S]*?)<\/a>/giu)) {
    const href = match[1].match(/href=["']([^"']+)["']/iu)?.[1]?.replaceAll("&amp;", "&");
    if (!href || !href.includes("ND_resrceFileDownload.do")) continue;
    const url = new URL(href, config.index_url);
    if (url.origin !== new URL(config.index_url).origin || !config.resource_ids.includes(url.searchParams.get("resrceSn"))) continue;
    if (match.index < sectionStart || match.index >= sectionEnd) throw Error("ATTACHMENT_OUTSIDE_ACCOUNT_SECTION");
    const label = match[2].replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
    const names = label.match(/\(([^)]+)\)/u)?.[1]?.split(",").map(normalizeName) ?? [normalizeName(label)];
    out.push({ id: url.searchParams.get("resrceSn") + "-" + url.searchParams.get("fileSn"), url: url.href, label, toc_names: names, toc_basis: "official_publisher_attachment_index", account_code: config.account_code, account_basis: "official_index_general_account_section" });
  }
  if (out.length !== config.expected_documents || new Set(out.map((d) => d.url)).size !== out.length) throw Error("OFFICIAL_CORPUS_INCOMPLETE");
  return out;
}

// Independent official organisation budget summary; never infer names from code digits.
// toc.scope_text: the organisation table's own title when it is not 「조직별」 (Hwaseong uses the statement's 실국·부서 summary).
// toc.exclude_pattern: out-of-scope units listed in the same table (읍·면·동, council secretariat).
export function organisationDepartments(parsed, year, accountName, toc = {}) {
  const text = normalizeName(parsed.blocks.map((b) => b.parsed_text_verbatim ?? "").join(" "));
  if (accountName && (accountName !== "일반회계" || !text.includes("일반회계") || text.includes("특별회계"))) throw Error("DEPARTMENT_TOC_ACCOUNT_MISMATCH");
  if (!text.includes(year + "년도본예산") || !text.includes(normalizeName(toc.scope_text ?? "조직별")) || !text.includes("단위:천원")) throw Error("DEPARTMENT_TOC_SCOPE_MISMATCH");
  const excluded = toc.exclude_pattern ? new RegExp(toc.exclude_pattern, "u") : null;
  const names = new Map();
  for (const table of parsed.tables) {
    if (!table.cells.some((cell) => normalizeName(cell.parsed_text_verbatim) === "예산액")) continue;
    for (const cell of table.cells.filter((cell) => cell.anchor_col < 2 && cell.anchor_row > 1)) {
      const name = normalizeName(cell.parsed_text_verbatim);
      if (!/^[\p{L}\p{N}·]+(?:과|실|담당관|사업소|추진단|읍|면|센터)$/u.test(name)) continue;
      if (excluded?.test(name)) continue;
      if (!names.has(name)) names.set(name, { table_id: table.table_id, row: cell.anchor_row, column: cell.anchor_col });
    }
  }
  if (!names.size) throw Error("DEPARTMENT_TOC_EMPTY");
  return { names: [...names.keys()], locations: Object.fromEntries(names) };
}

export function documentRows(document, parsed, config, year) {
  const accountRange = document.account_basis === "verified_pdf_account_chapter" ? verifiedAccountChapter(document, parsed, config, year) : null;
  const pages = new Map(), tables = new Map(parsed.tables.map((t) => [t.table_id, t]));
  for (const block of parsed.blocks) { if (!pages.has(block.page)) pages.set(block.page, []); pages.get(block.page).push(block); }
  const rows = [], audit = [];
  for (const [page, blocks] of pages) {
    if (accountRange && (page < accountRange.first || page > accountRange.last)) continue;
    const department = explicitPageDepartment(blocks);
    const pageTables = blocks.filter((b) => b.table_id).map((b) => tables.get(b.table_id)).filter(Boolean);
    const headerText = normalizeName(blocks.map((b) => b.parsed_text_verbatim ?? "").join(" "));
    const statementTables = pageTables.filter((t) => t.cells.some((c) => /부서.*정책.*세부사업/u.test(normalizeName(c.parsed_text_verbatim))));
    if (!statementTables.length) continue;
    const verified = Boolean(department && document.toc_names.includes(department));
    const accountVerified = document.account_code === config.account_code && (document.account_basis === "official_index_general_account_section" || Boolean(accountRange)) && !headerText.includes("특별회계");
    const unitVerified = pageUnitVerified(config, document, page, headerText, department);
    const reason = !department ? "missing_or_ambiguous_same_page_header" : !verified ? "header_not_in_official_toc" : !accountVerified ? "account_not_verified_in_index_or_page_conflict" : !unitVerified ? "amount_unit_not_explicit_on_page" : null;
    audit.push({ document_id: document.id, page, department, verified: !reason, reason, toc_names: document.toc_names });
    for (const table of statementTables) {
      const cols = table.logical_columns, grouped = new Map();
      for (const cell of table.cells.filter((c) => c.anchor_row > 0)) { if (!grouped.has(cell.anchor_row)) grouped.set(cell.anchor_row, []); grouped.get(cell.anchor_row).push(cell); }
      for (const [row, cells] of grouped) {
        const name = cells.filter((c) => c.anchor_col < cols - 3).sort((a, b) => a.anchor_col - b.anchor_col).map((c) => c.parsed_text_verbatim ?? "").join(" ").trim();
        const amount = (cells.find((c) => c.anchor_col === cols - 3)?.parsed_text_verbatim ?? "").split("\n")[0].trim();
        if (!name || !/^(?:\d{1,3}(?:,\d{3})*|\d+)$/u.test(amount)) continue;
        // Unverified headers stay in the uniqueness corpus, but can never authorize a mapping.
        rows.push({ fiscal_year: year, fiscal_entity_name: config.fiscal_entity_name, account_code: config.account_code, name, amount_krw: (BigInt(amount.replaceAll(",", "")) * 1000n).toString(), department_name: reason ? null : department, department_basis: reason ? null : "explicit_same_page_header_and_official_index", document_id: document.id, page, table_id: table.table_id, row, source_url: document.url, raw_sha256: document.sha256, toc_index_sha256: document.index_sha256, ...(document.department_toc ? { department_toc: { ...document.department_toc, location: document.department_toc.locations[department] ?? null } } : {}), stage: config.stage, hold_reason: reason });
      }
    }
  }
  return { rows, audit };
}

// The parser can drop the small "(단위:천원)" label on continuation pages. A page counts only when the
// label was parsed, or when a reviewer saw it on that exact page of that exact file under that department.
export function pageUnitVerified(config, document, page, headerText, department) {
  if (headerText.includes("단위:" + config.amount_unit) || headerText.includes("단위：" + config.amount_unit)) return true;
  return (config.unit_visual_confirmations ?? []).some((c) => c.document_id === document.id && c.page === page && c.raw_sha256 === document.sha256 && c.unit === config.amount_unit && c.department === department && headerText.includes("부서:" + department));
}

export function verifiedAccountChapter(document, parsed, config, year) {
  const scope = config.pdf_account_scope;
  if (!scope || !/^[a-f0-9]{64}$/u.test(scope.raw_sha256 ?? "") || document.sha256 !== scope.raw_sha256 || config.fiscal_year !== year || config.account_name !== "일반회계" || config.account_code !== "100") throw Error("PDF_ACCOUNT_SCOPE_UNVERIFIED");
  if (!Number.isInteger(scope.first) || !Number.isInteger(scope.last) || scope.first < 2 || scope.last < scope.first || scope.last >= 5000) throw Error("PDF_ACCOUNT_SCOPE_UNVERIFIED");
  const pageText = (page) => normalizeName(parsed.blocks.filter((b) => b.page === page).map((b) => b.parsed_text_verbatim ?? "").join(" "));
  // Some books print the cover and the account divider as images. Such a page (no extractable text at all, and only
  // then) may be read from a recorded visual reading; the scope's raw_sha256 pin above ties the reading to this file.
  const imageOnly = (page) => /^(?:-?\d{1,4}-?)?$/u.test(pageText(page));
  const seen = (page) => imageOnly(page) ? normalizeName((scope.visual_text ?? []).find((v) => v.page === page)?.text ?? "") : pageText(page);
  const endSeen = seen(scope.last + 1).includes(normalizeName(scope.end_heading));
  const endVisualOnly = endSeen && imageOnly(scope.last + 1);
  const machineSpecialSoon = [2, 3, 4, 5].some((offset) => pageText(scope.last + offset).includes("특별회계"));
  if (!pageText(scope.first).includes(normalizeName(scope.start_heading)) || !endSeen || (endVisualOnly && !machineSpecialSoon) || pageText(scope.first).includes("특별회계")) throw Error("PDF_ACCOUNT_BOUNDARY_CHANGED");
  const cover = seen(1);
  if (!cover.includes(year + "년도") || !scope.adoption_cover_text?.length || scope.adoption_cover_text.some((text) => !cover.includes(normalizeName(text)))) throw Error("PDF_ADOPTION_EVIDENCE_CHANGED");
  return { first: scope.first, last: scope.last };
}

// config.codes_created_after_book: department codes of units created after the adopted book (e.g. Hwaseong's 2026 행정구);
// the book can only show who budgeted a project, not the current name of a newer unit, so these are never named.
export function matchCorpus(items, rows, config = {}) {
  const api = items.map((r) => ({ project_id: r.fiscal_project_id, fiscal_year: r.fiscal_year, reference_date: r.reference_date, fiscal_entity_name: r.fiscal_entity.name, department_code: r.department_code, account_code: r.account.code, name: r.name, amount_krw: r.current_budget_krw }));
  const result = matchDepartments(api, rows);
  const invalid = result.mappings.filter((m) => !m.department_name || m.evidence.some((e) => !e.document.department_basis));
  result.held.push(...invalid.map((m) => ({ ...m, reason: "unverified_document_department" })));
  result.mappings = result.mappings.filter((m) => !invalid.includes(m));
  const newer = config.codes_created_after_book ? new RegExp(config.codes_created_after_book.pattern, "u") : null;
  const later = newer ? result.mappings.filter((m) => newer.test(m.department_code)) : [];
  result.held.push(...later.map((m) => ({ ...m, reason: "code_created_after_adopted_book" })));
  result.mappings = result.mappings.filter((m) => !later.includes(m));
  return result;
}

export function mergeReviewed(existing, mappings, reviewedKeys) {
  const key = (m) => [m.fiscal_entity_name, m.fiscal_year, m.reference_date, m.department_code].join("|");
  const merged = existing.mappings.slice();
  for (const mapping of mappings.filter((m) => reviewedKeys.includes(key(m)))) {
    if (!mapping.department_name || mapping.status !== "verified_exact" || new Set(mapping.evidence.map((e) => normalizeName(e.name))).size < 2 || mapping.evidence.some((e) => !e.document.department_basis)) throw Error("UNVERIFIED_MAPPING");
    const previous = merged.find((m) => key(m) === key(mapping));
    if (previous) { if (previous.department_name !== mapping.department_name) throw Error("EXISTING_MAPPING_CONFLICT"); continue; }
    const { evidence, ...entry } = mapping;
    merged.push({ ...entry, evidence_count: evidence.length, source_urls: [...new Set(evidence.map((e) => e.document.source_url))] });
  }
  return { ...existing, mappings: merged };
}
