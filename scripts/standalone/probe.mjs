import { register } from 'node:module'
register('./ts-resolve.mjs', import.meta.url)
const [biz, cls, svc, pr, guide, truth, pricing, finder] = await Promise.all([
  import('../../src/content/business.ts'), import('../../src/content/classes.ts'),
  import('../../src/content/services.ts'), import('../../src/content/prices.ts'),
  import('../../src/content/guide.ts'), import('../../src/content/truth.ts'),
  import('../../src/lib/pricing.ts'), import('../../src/lib/licence-finder.ts'),
])
console.log('classes:', cls.licenceClasses.length, '| services:', svc.services.length,
  '| finderQ:', finder.finderQuestions.length, '| guide:', guide.guideStages.length,
  '| locations:', biz.locations.length)
console.log('founded:', truth.publicValue(biz.business.founded))
console.log('prices exports:', Object.keys(pr).join(','))
console.log('pricing exports:', Object.keys(pricing).join(','))
