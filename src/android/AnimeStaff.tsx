import type { AnimeCredit } from "../types";

const ROLE_ORDER = [
  "动画制作",
  "原作", "原案", "原著",
  "总导演", "导演", "监督", "副导演",
  "系列构成", "脚本", "编剧",
  "分镜", "分镜脚本", "演出", "OP・ED 分镜", "OP・ED 演出",
  "人物设定", "副人物设定", "人物原案", "角色设计", "总作画监督", "作画监督", "作画监督助理",
  "原画", "第二原画", "动画", "动画检查", "补间动画", "机械设计", "道具设计", "特效",
  "美术监督", "美术监督助理", "美术设定", "美术设计", "美术板", "背景", "背景美术", "色彩设计", "色指定",
  "摄影监督", "摄影", "3D监督", "3D 设计", "CG监督", "剪辑", "编辑", "在线剪辑",
  "音响监督", "音响", "音响制作担当", "录音", "音乐", "音乐制作", "音乐制作人", "音乐助理",
  "主题歌", "主题歌作曲", "主题歌作词", "主题歌编曲", "主题歌演出", "插入歌",
  "制作", "制作公司", "制片人", "副制片人", "助理制片人", "宣传制片人", "动画制作人", "制作人",
  "企划", "出品", "监制", "制作协力", "设定制作", "制作进行", "制作进行协力", "制作管理",
  "协力", "设定协力", "製作",
];

function roleRank(role: string): number {
  const index = ROLE_ORDER.indexOf(role.trim());
  return index === -1 ? ROLE_ORDER.length : index;
}

export default function AnimeStaff({ staff }: { staff: AnimeCredit[] }) {
  const ordered = [...staff].sort((a, b) => roleRank(a.role) - roleRank(b.role));
  return <div className="gz-staff-list">
    {ordered.map(credit => <div className="gz-staff" key={credit.externalId}>
      <span className="gz-staff-avatar">
        <span className="gz-staff-initial" aria-hidden="true">{credit.name.slice(0, 1)}</span>
        {credit.imageUrl && <img src={credit.imageUrl} alt="" loading="lazy" decoding="async" draggable={false} onError={event => { event.currentTarget.hidden = true; }} />}
      </span>
      <strong className="gz-staff-name">{credit.name}</strong>
      <span className="gz-staff-role">{credit.role || "制作人员"}</span>
    </div>)}
  </div>;
}
