export const name = 'qq-qzone-deny-tools';
export const inject = ['tools'];
export function apply(ctx) {
  ctx.tools.restrict({allow:[]});
  ctx.tools.guard(()=>'动态阅读会话禁止调用工具');
}
