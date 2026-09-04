import { matchesFileSignature } from './file-signature.util';

function bytes(...values: number[]): Buffer {
  return Buffer.from(values);
}

function ascii(text: string, paddingLength = 0): Buffer {
  return Buffer.concat([Buffer.from(text, 'latin1'), Buffer.alloc(paddingLength)]);
}

describe('matchesFileSignature', () => {
  it('accepte un JPEG réel', () => {
    expect(matchesFileSignature(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0), 'image/jpeg')).toBe(true);
  });

  it('accepte un PNG réel', () => {
    expect(
      matchesFileSignature(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'image/png'),
    ).toBe(true);
  });

  it('accepte un GIF réel (87a ou 89a)', () => {
    expect(matchesFileSignature(ascii('GIF89a'), 'image/gif')).toBe(true);
    expect(matchesFileSignature(ascii('GIF87a'), 'image/gif')).toBe(true);
  });

  it('accepte un WebP réel (RIFF....WEBP)', () => {
    const buf = Buffer.concat([ascii('RIFF'), Buffer.alloc(4), ascii('WEBP')]);
    expect(matchesFileSignature(buf, 'image/webp')).toBe(true);
  });

  it('accepte un conteneur ISO BMFF (mp4/m4a/mov) avec une boîte ftyp', () => {
    const buf = Buffer.concat([Buffer.alloc(4), ascii('ftypisom')]);
    expect(matchesFileSignature(buf, 'video/mp4')).toBe(true);
    expect(matchesFileSignature(buf, 'audio/mp4')).toBe(true);
    expect(matchesFileSignature(buf, 'video/quicktime')).toBe(true);
  });

  it('accepte un conteneur WebM/Matroska réel (EBML)', () => {
    const buf = bytes(0x1a, 0x45, 0xdf, 0xa3);
    expect(matchesFileSignature(buf, 'video/webm')).toBe(true);
    expect(matchesFileSignature(buf, 'audio/webm')).toBe(true);
  });

  it('accepte un Ogg réel', () => {
    expect(matchesFileSignature(ascii('OggS'), 'audio/ogg')).toBe(true);
  });

  it('accepte un MP3 réel (tag ID3 ou synchro de trame)', () => {
    expect(matchesFileSignature(ascii('ID3'), 'audio/mpeg')).toBe(true);
    expect(matchesFileSignature(bytes(0xff, 0xfb), 'audio/mpeg')).toBe(true);
  });

  it('accepte un WAV réel (RIFF....WAVE)', () => {
    const buf = Buffer.concat([ascii('RIFF'), Buffer.alloc(4), ascii('WAVE')]);
    expect(matchesFileSignature(buf, 'audio/wav')).toBe(true);
    expect(matchesFileSignature(buf, 'audio/x-wav')).toBe(true);
  });

  it('refuse un contenu qui ne correspond pas au type déclaré (coeur de la protection)', () => {
    // Un fichier HTML/texte quelconque déclaré comme une image — exactement
    // le scénario que cette vérification doit bloquer.
    const fakeImage = Buffer.from('<script>alert(1)</script>', 'utf8');
    expect(matchesFileSignature(fakeImage, 'image/jpeg')).toBe(false);
    expect(matchesFileSignature(fakeImage, 'image/png')).toBe(false);
    expect(matchesFileSignature(fakeImage, 'video/mp4')).toBe(false);
    expect(matchesFileSignature(fakeImage, 'audio/wav')).toBe(false);
  });

  it('refuse un buffer trop court pour porter la signature attendue', () => {
    expect(matchesFileSignature(bytes(0xff), 'image/jpeg')).toBe(false);
    expect(matchesFileSignature(Buffer.alloc(0), 'image/png')).toBe(false);
  });

  it('refuse par défaut un type MIME sans vérification définie', () => {
    expect(matchesFileSignature(Buffer.from('peu importe'), 'application/x-nope')).toBe(false);
  });
});
