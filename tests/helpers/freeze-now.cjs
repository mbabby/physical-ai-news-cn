const RealDate = Date;
const frozenNow = new RealDate(process.env.FREEZE_NOW);

global.Date = class Date extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [frozenNow]));
  }

  static now() {
    return frozenNow.getTime();
  }
};
