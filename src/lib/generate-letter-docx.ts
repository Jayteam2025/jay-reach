import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx';

interface LetterData {
  recipientFirstName: string;
  recipientLastName: string;
  recipientTitle: string;
  companyName: string;
  companyAddress: string | null;
  companyZip: string | null;
  companyCity: string | null;
  companyCountry: string | null;
  body: string;
  senderName?: string;
  senderCompany?: string;
  senderStreet?: string;
  senderZipCity?: string;
  senderPhone?: string;
  senderEmail?: string;
  senderCity?: string;
}

const LOWER_WORDS_FR = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'l', 'd',
  'à', 'au', 'aux', 'en', 'et', 'par', 'pour', 'sur', 'sous',
]);

function titleCaseFr(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => {
      if (!w) return w;
      if (i > 0 && LOWER_WORDS_FR.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

function dedupAndFormatAddress(
  rawAddress: string,
  zip: string | null,
  city: string | null,
): { streetLine: string; zipCityLine: string } {
  let street = rawAddress.trim();

  if (zip) {
    street = street.replace(new RegExp(`\\b${zip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '');
  }
  if (city) {
    street = street.replace(new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '');
  }

  street = street.replace(/[,\s]+$/g, '').replace(/\s{2,}/g, ' ').trim();

  const streetLine = street ? titleCaseFr(street) : '';
  const zipCityLine = [zip, city ? city.toUpperCase() : null].filter(Boolean).join(' ');

  return { streetLine, zipCityLine };
}

function stripTrailingSignature(body: string): string {
  return body.replace(
    /\n+Alexandre\s+De\s+Clercq\s*\n\s*Jay\s*-\s*[+\d\s]+\s*$/i,
    '',
  ).trimEnd();
}

function formatDateFr(d: Date = new Date()): string {
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Genere un .docx format lettre professionnelle francaise, pret a
 * etre envoye a un service de robot manuscrit (Manuscry, Handwrytten).
 *
 * Structure :
 * - Expediteur haut-gauche
 * - Destinataire haut-droite
 * - Lieu + date (droite, sous destinataire)
 * - Corps (signature du body supprimee pour eviter doublon)
 * - Signature propre (bold nom + "Jay - tel")
 */
export async function generateLetterDocx(data: LetterData): Promise<Blob> {
  const {
    recipientFirstName,
    recipientLastName,
    recipientTitle,
    companyName,
    companyAddress,
    companyZip,
    companyCity,
    companyCountry,
    body,
    senderName = 'Alexandre De Clercq',
    senderCompany = 'Jay',
    senderStreet = '87 Rue du Fontenoy',
    senderZipCity = '59100 Roubaix',
    senderPhone = '+32 475 35 68 22',
    senderEmail = 'hey@jay-assistant.fr',
    senderCity = 'Roubaix',
  } = data;

  const fullName = `${recipientFirstName} ${recipientLastName}`.trim();
  const addr = dedupAndFormatAddress(companyAddress || '', companyZip, companyCity);
  const showCountry = companyCountry && companyCountry.toLowerCase() !== 'france';
  const cleanBody = stripTrailingSignature(body);
  const dateLine = `${senderCity}, le ${formatDateFr()}`;

  const paragraphs: Paragraph[] = [];

  paragraphs.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [new TextRun({ text: senderName, bold: true, size: 22 })],
  }));
  paragraphs.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [new TextRun({ text: senderCompany, size: 22 })],
  }));
  paragraphs.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [new TextRun({ text: senderStreet, size: 22 })],
  }));
  paragraphs.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [new TextRun({ text: senderZipCity, size: 22 })],
  }));
  paragraphs.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [new TextRun({ text: senderPhone, size: 22 })],
  }));
  paragraphs.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [new TextRun({ text: senderEmail, size: 22 })],
  }));

  paragraphs.push(new Paragraph({ children: [] }));

  paragraphs.push(new Paragraph({
    alignment: AlignmentType.RIGHT,
    children: [new TextRun({ text: fullName, bold: true, size: 24 })],
  }));
  if (recipientTitle) {
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: recipientTitle, size: 22 })],
    }));
  }
  paragraphs.push(new Paragraph({
    alignment: AlignmentType.RIGHT,
    children: [new TextRun({ text: companyName, size: 22 })],
  }));
  if (addr.streetLine) {
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: addr.streetLine, size: 22 })],
    }));
  }
  if (addr.zipCityLine) {
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: addr.zipCityLine, size: 22 })],
    }));
  }
  if (showCountry && companyCountry) {
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: companyCountry, size: 22 })],
    }));
  }

  paragraphs.push(new Paragraph({ children: [] }));

  paragraphs.push(new Paragraph({
    alignment: AlignmentType.RIGHT,
    children: [new TextRun({ text: dateLine, size: 24, italics: true })],
  }));

  paragraphs.push(new Paragraph({ children: [] }));
  paragraphs.push(new Paragraph({ children: [] }));

  const bodyParagraphs = cleanBody.split(/\n\s*\n/);
  for (const para of bodyParagraphs) {
    if (!para.trim()) continue;
    paragraphs.push(new Paragraph({
      children: [new TextRun({ text: para.trim(), size: 24 })],
      spacing: { after: 200 },
    }));
  }

  paragraphs.push(new Paragraph({ children: [] }));
  paragraphs.push(new Paragraph({
    children: [new TextRun({ text: senderName, bold: true, size: 24 })],
  }));
  paragraphs.push(new Paragraph({
    children: [new TextRun({ text: `${senderCompany} - ${senderPhone}`, size: 22 })],
  }));

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: paragraphs,
      },
    ],
  });

  return await Packer.toBlob(doc);
}

export async function downloadLetterDocx(
  data: LetterData,
  filename?: string,
): Promise<void> {
  const blob = await generateLetterDocx(data);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = data.companyName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  a.download = filename || `lettre-${safeName}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
