// SPDX-License-Identifier: GPL-3.0-only
// Adapted from N3urda/hongguoTV eea73e6a45569a2cbbb9440f7cd5290c459b0b70
// server/vendor/hongguo.cjs; originally drpys 22261adfa31435e3b3ef5a730b8a2a75bcaf1715.
// Static pure parsing/crypto functions only. No remote script execution.
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
const MAX_SAMPLES = 100000;

function str(value, fallback = '') { return String(value == null ? fallback : value).trim(); }

function cleanUrl(value) { return str(value).replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&'); }

function jsonBody(value) { try { return JSON.parse(value); } catch { return null; } }

function extractAssignedJson(source, marker = '_ROUTER_DATA') {
    const start = source.indexOf(marker);
    if (start < 0) throw new Error('页面没有路由数据');
    const first = source.indexOf('{', start);
    if (first < 0) throw new Error('路由数据格式错误');
    let depth = 0; let quote = false; let escaped = false;
    for (let i = first; i < source.length; i += 1) {
        const ch = source[i];
        if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quote = false; continue; }
        if (ch === '"') quote = true;
        else if (ch === '{' || ch === '[') depth += 1;
        else if (ch === '}' || ch === ']') { depth -= 1; if (depth === 0) return JSON.parse(source.slice(first, i + 1)); }
    }
    throw new Error('路由数据不完整');
}

function itemToCard(item) {
    const source = item?.video_data && typeof item.video_data === 'object' ? item.video_data : item;
    const categoryList = Array.isArray(source?.category_list) ? source.category_list.map((value) => value?.name || value).filter(Boolean) : [];
    const tags = Array.isArray(source?.tags) ? source.tags : categoryList;
    const count = Number(source?.episode_cnt || source?.series_episode_info?.episode_cnt || 0);
    return {
        url: str(source?.series_id), title: str(source?.series_name || source?.series_title || item?.name), img: cleanUrl(source?.series_cover),
        desc: str(source?.episode_right_text) || (count ? `全${count}集` : ''),
        tname: tags.slice(0, 5).join('/'), content: str(source?.series_intro),
    };
}

function parseFallback(value) {
    if (typeof value === 'string') { const parsed = jsonBody(value); return parsed?.fallback_api || value; }
    if (Array.isArray(value)) return str(value[0]);
    return str(value?.fallback_api);
}

function qualityNumber(value) {
    const text = str(value); const match = text.match(/(2160|1440|1080|720|576|540|480|360)/);
    if (match) return Number(match[1]);
    return ({ '1920': 1080, '1280': 720, '1024': 576, '854': 480, '640': 360 })[text] || (/^\d{3,4}$/.test(text) ? Number(text) : 0);
}

function qualityLabel(value) {
    const n = qualityNumber(value); if (n) return `${n}P`;
    const labels = { low: '流畅', smooth: '流畅', medium: '标清', normal: '高清', high: '超清', original: '原画', uhd: '原画', super_high: '原画' };
    return labels[str(value).toLowerCase()] || str(value, '自动');
}

function qualityRows(videoList) {
    const rows = [];
    if (!videoList || typeof videoList !== 'object') return rows;
    for (const [key, value] of Object.entries(videoList)) {
        const item = value && typeof value === 'object' ? value : {};
        const quality = str(item.quality_desc || item.height || item.vheight || item.quality || key);
        if (item.main_url && !rows.some((row) => row.quality === key)) rows.push({ key, quality, item });
    }
    return rows.sort((a, b) => qualityNumber(b.quality || b.key) - qualityNumber(a.quality || a.key));
}

function deriveContentKey(value) {
    const raw = Buffer.from(str(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (raw.length < 3) throw new Error('spade_a too short');
    let v8 = raw.length - (raw[0] ^ raw[1] ^ raw[2]) + 47;
    v8 = Math.min(v8, raw.length - 1);
    if (v8 < 33) throw new Error('spade_a key length invalid');
    const work = Buffer.from(raw.subarray(1, 1 + v8)); let a = 85; let b = 246;
    for (let i = 0; i < v8; i += 1) {
        const old = work[i]; const previous = i & 1 ? a : b;
        if (i & 1) a = old; else b = old;
        const pop = i.toString(2).split('1').length - 1;
        work[i] = (-21 - pop + (previous ^ old)) & 255;
    }
    return Buffer.from(work.subarray(1, 33).toString('ascii'), 'hex');
}

function decryptSpadeUrl(value, seed) {
    const encoded = str(value); if (!encoded) return '';
    const raw = Buffer.from(encoded, 'base64');
    if (raw.length < 5) throw new Error('spade URL ciphertext too short');
    if (raw[0] !== 0xa8 || raw[2] !== 0x01 || raw[3] !== 0x00) throw new Error('spade URL header format error');
    const cipherLength = Math.floor((raw.length - 4) / 16) * 16;
    if (!cipherLength) throw new Error('spade URL ciphertext has no complete block');
    const constants = Buffer.from('4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524f49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58', 'hex');
    const h1 = crypto.createHash('sha512').update(seed).digest(); const h2 = crypto.createHash('sha512').update(Buffer.concat([h1, constants])).digest();
    const decipher = crypto.createDecipheriv('aes-128-cbc', h2.subarray(0, 16), h2.subarray(16, 32));
    decipher.setAutoPadding(false);
    let plaintext = Buffer.concat([decipher.update(raw.subarray(4, 4 + cipherLength)), decipher.final()]);
    if (plaintext.length) {
        const padding = plaintext[plaintext.length - 1];
        if (padding >= 1 && padding <= 16 && padding <= plaintext.length) plaintext = plaintext.subarray(0, plaintext.length - padding);
    }
    while (plaintext.length && plaintext[plaintext.length - 1] === 0) plaintext = plaintext.subarray(0, plaintext.length - 1);
    return plaintext.toString('utf8');
}

function readBox(data, offset) {
    if (offset < 0 || offset + 8 > data.length) return null;
    let size = data.readUInt32BE(offset); const type = data.toString('ascii', offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
        if (offset + 16 > data.length) return null;
        const large = data.readBigUInt64BE(offset + 8); if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        size = Number(large); header = 16;
    } else if (size === 0) size = data.length - offset;
    if (size < header || offset + size > data.length) return null;
    return { offset, size, type, header, bodyStart: offset + header };
}

function findBox(data, type, start = 0) {
    for (let offset = Math.max(0, start); offset + 8 <= data.length; offset += 1) {
        const box = readBox(data, offset);
        if (box?.type === type) return box;
    }
    return null;
}

function boxBody(data, type, start = 0) {
    const box = findBox(data, type, start); return box ? data.subarray(box.bodyStart, box.offset + box.size) : null;
}

function readU64(data, offset) {
    const value = data.readBigUInt64BE(offset); if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MP4 offset too large');
    return Number(value);
}

function parseTrack(moov, track) {
    const stbl = findBox(moov, 'stbl', track.bodyStart); if (!stbl) return null;
    const stsz = boxBody(moov, 'stsz', stbl.bodyStart); const stsc = boxBody(moov, 'stsc', stbl.bodyStart);
    const chunkBox = findBox(moov, 'stco', stbl.bodyStart) || findBox(moov, 'co64', stbl.bodyStart);
    const saiz = boxBody(moov, 'saiz', stbl.bodyStart); const saio = boxBody(moov, 'saio', stbl.bodyStart);
    if (!stsz || !stsc || !chunkBox || !saiz || !saio || stsz.length < 12 || stsc.length < 8 || saiz.length < 9 || saio.length < 8) return null;
    const defaultSampleSize = stsz.readUInt32BE(4); const sampleCount = stsz.readUInt32BE(8); const sizes = [];
    if (sampleCount > MAX_SAMPLES) throw new Error('MP4 sample index exceeds limit');
    if (defaultSampleSize) { for (let i=0; i<sampleCount; i++) sizes.push(defaultSampleSize); }
    else for (let i = 0; i < sampleCount && 12 + (i + 1) * 4 <= stsz.length; i += 1) sizes.push(stsz.readUInt32BE(12 + i * 4));
    if (sizes.length !== sampleCount) return null;
    const chunkCount = chunkBox.bodyStart + 8 <= chunkBox.offset + chunkBox.size ? moov.readUInt32BE(chunkBox.bodyStart + 4) : 0;
    const offsets = [];
    for (let i = 0; i < chunkCount; i += 1) {
        const at = chunkBox.bodyStart + 8 + i * (chunkBox.type === 'co64' ? 8 : 4);
        if (at + (chunkBox.type === 'co64' ? 8 : 4) > chunkBox.offset + chunkBox.size) return null;
        offsets.push(chunkBox.type === 'co64' ? readU64(moov, at) : moov.readUInt32BE(at));
    }
    const entryCount = stsc.readUInt32BE(4); const entries = [];
    for (let i = 0; i < entryCount; i += 1) {
        const at = 8 + i * 12; if (at + 8 > stsc.length) return null;
        entries.push({ firstChunk: stsc.readUInt32BE(at), samplesPerChunk: stsc.readUInt32BE(at + 4) });
    }
    const samplesPerChunk = offsets.map((_value, index) => {
        let selected = 0; for (const entry of entries) if (entry.firstChunk <= index + 1) selected = entry.samplesPerChunk; return selected;
    });
    const auxDefault = saiz[4]; const auxCount = saiz.readUInt32BE(5); const auxSizes = [];
    if (auxCount > MAX_SAMPLES) throw new Error('MP4 auxiliary index exceeds limit');
    if (auxDefault) { for (let i=0; i<auxCount; i++) auxSizes.push(auxDefault); }
    else for (let i = 0; i < auxCount && 9 + i < saiz.length; i += 1) auxSizes.push(saiz[9 + i]);
    if (auxSizes.length !== auxCount) return null;
    const saioVersion = saio.readUInt32BE(0) >>> 24; const offsetSize = saioVersion === 1 ? 8 : 4;
    const saioCount = saio.readUInt32BE(4); if (!saioCount || 8 + offsetSize > saio.length) return null;
    const auxOffset = offsetSize === 8 ? readU64(saio, 8) : saio.readUInt32BE(8);
    return { sizes, offsets, samplesPerChunk, auxOffset, auxSizes, sampleCount };
}

function buildSamples(data, tracks) {
    const samples = [];
    for (const track of tracks) {
        let sampleIndex = 0; let auxPos = 0;
        const auxTotal = track.auxSizes.reduce((sum, size) => sum + Math.max(size, 8), 0);
        if (track.auxOffset < 0 || track.auxOffset + auxTotal > data.length) throw new Error('MP4 auxiliary data out of range');
        const aux = data.subarray(track.auxOffset, track.auxOffset + auxTotal);
        for (let chunk = 0; chunk < track.offsets.length && sampleIndex < track.sampleCount; chunk += 1) {
            let offset = track.offsets[chunk]; const count = track.samplesPerChunk[chunk] || 0;
            for (let index = 0; index < count && sampleIndex < track.sampleCount; index += 1) {
                const size = track.sizes[sampleIndex]; const auxSize = Math.max(track.auxSizes[sampleIndex] || 8, 8);
                if (auxSize !== 8) throw new Error('Unsupported CENC subsample or IV format');
                if (samples.length >= MAX_SAMPLES) throw new Error('MP4 combined sample index exceeds limit');
                if (offset + size > Number.MAX_SAFE_INTEGER || auxPos + auxSize > aux.length) throw new Error('MP4 sample index out of range');
                const iv = Buffer.alloc(16); aux.copy(iv, 0, auxPos, auxPos + Math.min(8, auxSize));
                samples.push({ start: offset, end: offset + size, iv }); offset += size; sampleIndex += 1; auxPos += auxSize;
            }
        }
    }
    return samples.sort((a, b) => a.start - b.start);
}

function replaceFourcc(data, from, to) {
    let offset = 0; const source = Buffer.from(from);
    while ((offset = data.indexOf(source, offset)) >= 0) { data.write(to, offset, 'ascii'); offset += source.length; }
}

function replaceSinf(data) {
    let offset = 0;
    while ((offset = data.indexOf(Buffer.from('sinf'), offset)) >= 0) {
        if (offset < 4) { offset += 4; continue; }
        const size = data.readUInt32BE(offset - 4); const end = offset - 4 + size;
        if (size >= 8 && size < 50000 && end <= data.length) { data.write('free', offset, 'ascii'); data.fill(0, offset + 4, end); offset = end; }
        else offset += 4;
    }
}

function prepareCencHeader(data, key) {
    const ftypSize = data.readUInt32BE(0); const moov = readBox(data, ftypSize);
    if (!moov || moov.type !== 'moov') throw new Error('invalid MP4 moov');
    const moovBody = data.subarray(moov.bodyStart, moov.offset + moov.size); const tracks = [];
    let cursor = 0; while (true) { const track = findBox(moovBody, 'trak', cursor); if (!track) break; tracks.push(track); cursor = track.offset + track.size; }
    const parsed = tracks.map((track) => {
        const result = parseTrack(moovBody, track);
        const bytes = moovBody.subarray(track.offset, track.offset + track.size);
        if (key && !result && (bytes.includes(Buffer.from('encv')) || bytes.includes(Buffer.from('enca')))) throw new Error('Unsupported CENC track index');
        return result;
    }).filter(Boolean);
    const samples = key ? buildSamples(data, parsed) : [];
    const header = Buffer.from(data.subarray(0, moov.offset + moov.size));
    for (const kind of ['encv', 'enca']) {
        let at=0;
        while ((at=header.indexOf(Buffer.from(kind), at)) >= 0) {
            const entry=readBox(header, at-4);
            if (!entry || entry.type !== kind) { at+=4; continue; }
            const within=header.subarray(entry.bodyStart, entry.offset+entry.size);
            const frma=findBox(within,'frma');
            const codec=frma && frma.size >= 12 ? within.toString('ascii',frma.bodyStart,frma.bodyStart+4) : '';
            if (!['hvc1','hev1','avc1','avc3','mp4a'].includes(codec)) throw new Error('Unsupported protected sample entry codec');
            header.write(codec,at,'ascii'); at+=4;
        }
    }
    replaceSinf(header);
    return { header, samples };
}

function addCounter(iv, blocks) {
    const value = (iv.readBigUInt64BE(0) << 64n) | iv.readBigUInt64BE(8); const next = (value + BigInt(blocks)) & ((1n << 128n) - 1n);
    const result = Buffer.alloc(16); result.writeBigUInt64BE(next >> 64n, 0); result.writeBigUInt64BE(next & ((1n << 64n) - 1n), 8); return result;
}

function decryptPartial(data, start, key, prepared) {
    const output = Buffer.from(data); const end = start + output.length;
    if (start < prepared.header.length) prepared.header.copy(output, 0, start, Math.min(end, prepared.header.length));
    if (!key) return output;
    let low = 0, high = prepared.samples.length;
    while (low < high) { const mid = (low + high) >>> 1; if (prepared.samples[mid].end <= start) low = mid + 1; else high = mid; }
    let index = low;
    for (; index < prepared.samples.length; index += 1) {
        const sample = prepared.samples[index]; if (sample.start >= end) break;
        const overlapStart = Math.max(start, sample.start); const overlapEnd = Math.min(end, sample.end); if (overlapStart >= overlapEnd) continue;
        const relative = overlapStart - sample.start; const block = Math.floor(relative / 16); const skip = relative % 16;
        const decipher = crypto.createDecipheriv('aes-128-ctr', key, addCounter(sample.iv, block));
        if (skip) decipher.update(Buffer.alloc(skip));
        const decrypted = Buffer.concat([decipher.update(output.subarray(overlapStart - start, overlapEnd - start)), decipher.final()]);
        decrypted.copy(output, overlapStart - start);
    }
    return output;
}

export { str, cleanUrl, jsonBody, extractAssignedJson, itemToCard, parseFallback, qualityNumber, qualityLabel, qualityRows, deriveContentKey, decryptSpadeUrl, readBox, findBox, boxBody, readU64, parseTrack, buildSamples, replaceFourcc, replaceSinf, prepareCencHeader, addCounter, decryptPartial };
