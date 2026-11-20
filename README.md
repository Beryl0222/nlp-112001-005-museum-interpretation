# 跨馆展签中有争议的文化解释

跨馆联展资料采用 UTF-8 编码，人物、单位和记录均为合成内容。

| 资料 | 字段 |
| --- | --- |
| `资料/藏品.json` | `id`、`museum`、`alias`、`period`、`label` |
| `资料/手记.json` | `id`、`author`、`language`、`subject`、`text` |
| `资料/展柜计划.json` | `id`、`stop`、`language`、`items`、`limit` |

每份资料是 JSON 数组。记录中的字段值按来源原样保留为字符串，逗号和顿号可以属于字段内容。资料中可能有转述、不同的拼写以及较晚录入的更正。数字及日期在这些文件中沿用各资料自身的含义；原文位置以记录编号及文本范围定位。

Node.js 22 环境下运行以下命令可安装锁定的项目环境、检查素材格式并读取各类资料的数量。

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm test
npm run materials
```

`readMaterials` 只读取资料，不解析其中的正文含义。

## 策展工作台

`workbench.js` 在资料之上提供展签撰写与审校。核心约定：

- **主张分级**：馆藏卡为事实（保留"疑似"等限定），手记按原文语气分为推测／有证据／不详，译稿一律先审后发。每条主张以记录编号与文本范围定位。
- **指称分类**：名称按语境区分实物、类型（"另一个同类钵"）与地名（"西坡疑似仪式坑"）；年代只按原文保留，世纪范围仅供内部比较。
- **译文审校**：同一实物同一命题下，译文语气强于来源即构成冲突（如 n4 把 n1 的"也许"译成 definitely），责任译句暂缓，来源句不受牵连。
- **比较主张**：跨实物比较要求两边各有独立依据；只有推测级依据时只能以带出处形式发布。
- **句子判定**：每句给出 可沿用／带出处的比较／暂缓；容量不足时先删出处前缀，再按比较句、术语句、后站可见句的顺序暂缓；限定语与争议一方不得删。
- **动线联审**：术语按动线流动，前站给出的概念后站可复用；换入替补计划后，下游展签须补释义或调整比较对象，联审关系注明来自哪项实物、主张或术语。
- **发布**：暂缓句留在编辑端，有依据的介绍照常发布；观众扫展柜编号只看当前生效文字与可公开出处，研究员可回看各版本的判定与当时的未决冲突。

```sh
node workbench.js overview            # 实物、主张、冲突总览
node workbench.js case c1             # 该展柜的展签草稿（逐句判定）
node workbench.js route               # 动线上的术语流动
node workbench.js joint-review        # 相邻展签的联审关系及来源
node workbench.js swap c3             # 换展影响：术语缺口与下游动作
node workbench.js translate-review    # 译文审校明细
node workbench.js publish c1 --by 策展员甲 --note 首版
node workbench.js visitor c1          # 观众视图
node workbench.js history c1          # 研究员回看
node workbench.js confirm-alias rimmed\ bowl q-31
node workbench.js merge q-31,q-38 q-he && node workbench.js split q-he
```

编辑动作（别名确认、误合与拆分、发布）记录在 `.workbench-state.json`（已 gitignore），每次启动按顺序重放；拆分后主张按各自来源重新归属，证据不复制给拆出的对象。

### 模块

| 文件 | 职责 |
| --- | --- |
| `src/entities.js` | 年代解析、实物／类型／地名指称、别名确认、误合与拆分 |
| `src/claims.js` | 主张提取（语气、槽位、定位）、译文审校、比较主张 |
| `src/labels.js` | 术语表、双语模板渲染、句子判定、容量与简版守卫 |
| `src/route.js` | 动线结构、联审关系、换展影响对比 |
| `src/publication.js` | 发布门控、观众视图、研究员历史 |
| `src/workbench.js` | 门面：加载资料、重放编辑动作、组合各模块 |
