#!/usr/bin/env node

const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`Request failed: ${res.statusCode} ${res.statusMessage}`));
          }
        });
      })
      .on('error', reject);
  });
}

function escapeBibTeX(str = '') {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/"/g, '\\"');
}

function parseTag(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function parseAllTags(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const matches = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    matches.push(match[1].trim());
  }
  return matches;
}

function stripXml(str = '') {
  return str.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function buildAuthorList(articleXml) {
  const authorBlocks = articleXml.match(/<Author\b[\s\S]*?<\/Author>/gi) || [];
  const authors = authorBlocks.map((authorXml) => {
    const lastName = stripXml(parseTag(authorXml, 'LastName'));
    const foreName = stripXml(parseTag(authorXml, 'ForeName'));
    const collectiveName = stripXml(parseTag(authorXml, 'CollectiveName'));

    if (collectiveName) return collectiveName;
    if (lastName && foreName) return `${lastName}, ${foreName}`;
    if (lastName) return lastName;
    return '';
  }).filter(Boolean);

  return authors.join(' and ');
}

function extractPubDate(articleXml) {
  const pubDateBlockMatch = articleXml.match(/<PubDate\b[\s\S]*?<\/PubDate>/i);
  if (!pubDateBlockMatch) return '';

  const pubDateXml = pubDateBlockMatch[0];
  let year = stripXml(parseTag(pubDateXml, 'Year'));

  if (!year) {
    const medlineDate = stripXml(parseTag(pubDateXml, 'MedlineDate'));
    const yearMatch = medlineDate.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) year = yearMatch[0];
  }

  return year;
}

function buildCitationKey(authors, year, title) {
  const firstAuthorLast = authors.split(' and ')[0]?.split(',')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'unknown';
  const shortTitle = (title || '')
    .toLowerCase()
    .split(/\s+/)
    .slice(0, 3)
    .join('')
    .replace(/[^a-z0-9]/g, '') || 'article';

  return `${firstAuthorLast}${year || 'nodate'}${shortTitle}`;
}

async function doiToBibTeX(doi) {
  const encodedDoi = encodeURIComponent(doi);

  const esearchUrl =
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodedDoi}[AID]&retmode=json`;

  const esearchRaw = await fetchUrl(esearchUrl);
  let esearch;
  try {
    esearch = JSON.parse(esearchRaw);
  } catch (parseErr) {
    throw new Error(`Failed to parse PubMed esearch response for DOI: ${doi}`);
  }

  const idList = esearch?.esearchresult?.idlist || [];
  if (!idList.length) {
    throw new Error(`No PubMed record found for DOI: ${doi}`);
  }

  const pmid = idList[0];

  const efetchUrl =
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml`;

  const efetchXml = await fetchUrl(efetchUrl);

  const articleMatch = efetchXml.match(/<PubmedArticle\b[\s\S]*?<\/PubmedArticle>/i);
  if (!articleMatch) {
    throw new Error(`Could not parse PubMed article for PMID: ${pmid}`);
  }

  const articleXml = articleMatch[0];

  const title = stripXml(parseTag(articleXml, 'ArticleTitle'));
  const journal = stripXml(parseTag(articleXml, 'Title'));
  const volume = stripXml(parseTag(articleXml, 'Volume'));
  const number = stripXml(parseTag(articleXml, 'Issue'));
  const pages = stripXml(parseTag(articleXml, 'MedlinePgn'));
  const year = extractPubDate(articleXml);
  const authors = buildAuthorList(articleXml);

  let articleType = '';
  const publicationTypes = parseAllTags(articleXml, 'PublicationType').map(stripXml);
  if (publicationTypes.length) {
    articleType = publicationTypes[0];
  }

  const citationKey = buildCitationKey(authors, year, title);

  return `@article{${citationKey},
  author  = {${escapeBibTeX(authors)}},
  title   = {${escapeBibTeX(title)}},
  journal = {${escapeBibTeX(journal)}},
  volume  = {${escapeBibTeX(volume)}},
  number  = {${escapeBibTeX(number)}},
  pages   = {${escapeBibTeX(pages)}},
  doi     = {${escapeBibTeX(doi)}},
  year    = {${escapeBibTeX(year)}},
  type    = {${escapeBibTeX(articleType)}}
}`;
}

async function main() {
  const doi = process.argv[2]?.trim();

  if (!doi) {
    console.error('Usage: node pubmed-doi-to-bibtex.js <doi>');
    process.exit(1);
  }

  try {
    const bibtex = await doiToBibTeX(doi);
    console.log(bibtex);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();