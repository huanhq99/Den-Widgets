import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRunner} from '@denplayer/widget-sdk/testing';

const script = await readFile(new URL('./widget.js', import.meta.url), 'utf8');
const fixtures = JSON.parse(await readFile(new URL('./fixtures.json', import.meta.url), 'utf8'));
for (const profile of ['common', 'tv']) {
  test(profile + ': metadata, paging, search, lazy detail and selected playback', async () => {
    const runner = createRunner({script, fixtures, profile});
    assert.equal((await runner.inspect()).validation.valid, true);
    const items = (await runner.invoke('list', {page: 1}, 'list')).value;
    assert.equal(items[0].title, '示例影片');
    assert.equal((await runner.invoke('search', {keyword: 'demo', page: 1}, 'list')).value.length, 1);
    const detail = await runner.invoke('loadDetail', {link: items[0].link}, 'detail');
    assert.equal(detail.requests.length, 1, 'detail must not resolve every version');
    const stream = await runner.invoke('resolve', {link: detail.value.episodeItems[0].link}, 'detail');
    assert.match(stream.value.videoUrl, /\.mp4$/);
  });
}
