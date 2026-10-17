import json
import sqlite3
import sys
import uuid
from pathlib import Path

database, metadata_file, marker = map(str, sys.argv[1:4])
path = Path(database).resolve()
assert path.is_relative_to(Path('D:/DevTools/Android/Build/qa/blue-box-cover-20261017').resolve())
assert path.name == 'qa-genzo.db' and marker.startswith('GenzoCoverQA-')
public = json.loads(Path(metadata_file).read_text(encoding='utf-8-sig'))
assert public['id'] == 548156 and public['name_cn'] == '青之箱 第二季'
metadata = dict(provider='bangumi', externalId='548156', title=public['name_cn'], originalTitle=public['name'], aliases=[], description=public.get('summary', ''), coverUrl=public['images']['large'], bannerUrl=None, year=2026, season=None, subjectType='tv', genres=[], fetchedAt='2026-10-17T00:00:00Z')
connection = sqlite3.connect(path)
assert not connection.execute("select 1 from work_external_ids where provider='bangumi' and external_id='548156'").fetchone()
work = str(uuid.uuid4())
connection.execute("insert into works(id,title,original_title,type,description,cover_path,status,favorite,rating,notes,created_at,updated_at,metadata_status,metadata_year) values(?,?,?,'video',?,NULL,'in_progress',1,9,?,'2026-10-17','2026-10-17','matched',2026)", (work, metadata['title'], metadata['originalTitle'], metadata['description'], marker))
connection.execute("insert into work_external_ids(work_id,provider,external_id,created_at,updated_at) values(?,'bangumi','548156','2026-10-17','2026-10-17')", (work,))
connection.execute("insert into metadata_provider_records(work_id,provider,external_id,title,confidence,response_json,fetched_at) values(?,'bangumi','548156',?,1,?,'2026-10-17')", (work, metadata['title'], json.dumps(metadata)))
connection.commit()
clean = path.with_name('qa-seeded.db')
with sqlite3.connect(clean) as output:
    connection.backup(output)
connection.close()
print(json.dumps(dict(workId=work, database=str(clean), coverUrl=metadata['coverUrl'])))
