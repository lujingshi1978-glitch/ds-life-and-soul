export const name = 'qq-intimacy-judge-deny-tools';
export const inject = ['tools'];
export function apply(ctx) {
  ctx.tools.restrict({ allow: [] });
  ctx.tools.guard(() => '亲密度评估会话禁止调用任何工具');
}
