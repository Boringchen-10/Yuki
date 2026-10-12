"""Only the guarded, stopped organizeqa package's synthetic work is changed."""
from pathlib import Path
import hashlib, json, sqlite3, sys
from PIL import Image, ImageDraw

folder = Path(sys.argv[1])
seed = json.loads((folder / 'seed.json').read_text(encoding='utf8'))
assert seed['app'] == 'com.genzo.android.organizeqa'
assert seed['dataDirectory'] == '/data/user/0/com.genzo.android.organizeqa'
db = sqlite3.connect(folder / 'genzo.db')
db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
work = seed['workId']
assert db.execute('SELECT title FROM works WHERE id=?', (work,)).fetchone()[0].startswith('GenzoPortraitQA-')
anchors = ['400602', '302286', '292970']
bangumi = next(value for value in anchors if not db.execute("SELECT 1 FROM work_external_ids WHERE provider='bangumi' AND external_id=?", (value,)).fetchone())
now = '2026-10-12T00:00:00Z'
db.execute("INSERT INTO work_external_ids VALUES(?,?,?,?,?)", (work, 'bangumi', bangumi, now, now))
series = 900000001
db.execute("INSERT INTO episode_artwork_sources(work_id,anchor,series_id,season_number,method,updated_at,episode_offset) VALUES(?,?,?,1,'manual',?,0)", (work, f'bangumi:{bangumi}', series, now))
episodes, images = [], []
for number, media_id in enumerate(seed['mediaIds'], 1):
    external = f'genzo-portrait-{seed["run"]}-{number}'
    assert db.execute('SELECT work_id FROM media_files WHERE id=?', (media_id,)).fetchone()[0] == work
    db.execute("INSERT INTO anime_episodes(work_id,provider,external_id,episode_number,sort_number,title,fetched_at,episode_type) VALUES(?,'bangumi',?,?,?,?,?,0)", (work, external, number, number, f'QA 官方第 {number} 集', now))
    db.execute("INSERT INTO media_episode_links VALUES(?,?,'bangumi',?,'manual',1,?)", (media_id, work, external, now))
    still = f'/genzo-portrait-{seed["run"]}-{number}.png'
    url = f'https://image.tmdb.org/t/p/original{still}'
    digest = hashlib.sha256(f'{work}:episode:{url}'.encode()).hexdigest()[:24]
    filename = f'art-v2-{digest}-episode.jpg'
    image = Image.new('RGB', (640, 360), ('#2866bb', '#bb5528')[number - 1])
    draw = ImageDraw.Draw(image)
    draw.rectangle((20, 20, 620, 340), outline='white', width=5)
    draw.text((275, 165), f'EP {number:02}', fill='white', stroke_width=1)
    image.save(folder / filename, quality=90)
    images.append(filename)
    episodes.append({'season_number': 1, 'episode_number': number, 'still_path': still})
data = json.dumps({'name': 'Genzo synthetic stills', 'episodes': episodes})
key = f'film-tv:zh-CN:tv/{series}/season/1:[]'
db.execute("INSERT OR REPLACE INTO metadata_cache VALUES('tmdb',?,?,?,?)", (key, data, now, '2099-01-01T00:00:00Z'))
db.commit()
db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
db.close()
(folder / 'seed-result.json').write_text(json.dumps({'images': images, 'bangumiId': bangumi, 'cacheKey': key}), encoding='utf8')
