export const name='qq-contact-memory-deny-tools';
export const inject=['tools'];
export function apply(ctx){ctx.tools.restrict({allow:[]});ctx.tools.guard(()=>'画像和图片记忆会话禁止调用工具');}
