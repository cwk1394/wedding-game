// 이동 가능 영역 (발판 · 사다리 · 로프). 개발자 모드(?dev)에서 저장하면 이 파일이 통째로 다시 만들어진다.
// floors: { 이름: { path: [[x, y], ...] } } — 배경 이미지 픽셀 좌표, x 오름차순 꺾은선. stage = 신랑/신부 자리
// climbs: [{ type: ladder|rope, x, floors: [층A, 층B] }]
const MAP_DATA = {
  floors: {
    "balloon": { "path": [[118,276],[294,276]] },
    "welcome": { "path": [[545,322],[1068,322]] },
    "upperRoute": { "path": [[8,362],[150,362],[182,392],[382,392],[440,460],[650,462],[700,480],[800,484],[860,496],[1040,496]] },
    "rightStairs": { "path": [[792,500],[872,612],[1100,618]] },
    "cherry": { "path": [[168,553],[320,553]] },
    "middleRoute": { "path": [[12,692],[560,692],[615,638],[828,632]] },
    "gazebo": { "path": [[845,842],[1108,842]] },
    "lowerRoute": { "path": [[72,862],[165,864],[180,877],[255,881],[322,893],[640,897],[700,925],[745,935],[790,931],[1008,940]] },
    "heartBridge": { "path": [[612,1090],[850,1085],[1110,1066]] },
    "boat": { "path": [[150,1176],[410,1180],[452,1202],[660,1206]] },
    "plaza": { "path": [[692,1290],[1100,1300]] },
    "stage": { "path": [[742,318],[808,318]] },
  },
  climbs: [
    {"type":"ladder","x":767,"floors":["welcome","upperRoute"]},
    {"type":"ladder","x":767,"floors":["upperRoute","middleRoute"]},
    {"type":"ladder","x":439,"floors":["upperRoute","middleRoute"]},
    {"type":"ladder","x":406,"floors":["middleRoute","lowerRoute"]},
    {"type":"ladder","x":1033,"floors":["gazebo","heartBridge"]},
    {"type":"ladder","x":618,"floors":["heartBridge","boat"]},
    {"type":"rope","x":289,"floors":["balloon","upperRoute"]},
    {"type":"rope","x":316,"floors":["upperRoute","cherry"]},
    {"type":"rope","x":280,"floors":["cherry","middleRoute"]},
  ],
};
