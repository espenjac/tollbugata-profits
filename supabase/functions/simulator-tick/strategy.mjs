var DEFAULT_SETTINGS = {
	scoring: {
		minPrice: 5,
		minMarketCap: 3e8,
		minAverageTurnover: 3e6,
		maxWeekReturn: .25,
		maxRsi: 82,
		targetAtrPct: .025,
		breakoutDistance: .05,
		overextendedWeek: .15,
		overextendedRsi: 75,
		smoothDayReturn: .02,
		smoothDayShare: .4,
		spikeDayReturn: .04,
		spikeDayShare: .6,
		strongSpikeDayReturn: .07,
		spikeSma5Distance: .05,
		riskPenalty: .45,
		weights: {
			momentum: .16,
			trend: .14,
			relativeStrength: .09,
			liquidity: .15,
			volume: .09,
			technicalUpside: .08,
			volatility: .05,
			news: .11,
			breakout: .05,
			consistency: .08
		},
		riskWeights: {
			volatility: .18,
			overextension: .18,
			spike: .12,
			liquidity: .14,
			event: .14,
			negativeNews: .14,
			marketCap: .05,
			price: .05
		}
	},
	trade: {
		capital: 5e3,
		buyFee: 29,
		sellFee: 29,
		mode: "swing",
		targetPct: .1,
		stopLossPct: .05,
		slippagePct: 0,
		minRewardRisk: 1,
		scenarioPcts: [
			-.06,
			-.03,
			0,
			.03,
			.05,
			.08,
			.1,
			.13
		]
	},
	report: {
		maxAlternatives: 10,
		minTotalScore: 58,
		minOpportunity: 55,
		maxRisk: 58,
		minTurnover: 1e7,
		blockNegativeNews: true,
		blockEarningsWithinDays: 1,
		blockExDateWithinDays: 0
	}
};
function mergeSettings(partial) {
	return {
		scoring: {
			...DEFAULT_SETTINGS.scoring,
			...partial.scoring,
			weights: {
				...DEFAULT_SETTINGS.scoring.weights,
				...partial.scoring?.weights
			},
			riskWeights: {
				...DEFAULT_SETTINGS.scoring.riskWeights,
				...partial.scoring?.riskWeights
			}
		},
		trade: {
			...DEFAULT_SETTINGS.trade,
			...partial.trade
		},
		report: {
			...DEFAULT_SETTINGS.report,
			...partial.report
		}
	};
}
function settingsForCapital(settings, capital) {
	return {
		...settings,
		trade: {
			...settings.trade,
			capital
		}
	};
}
// node_modules/date-fns-tz/dist/esm/_lib/tzTokenizeDate/index.js
/**
* Returns the [year, month, day, hour, minute, seconds] tokens of the provided
* `date` as it will be rendered in the `timeZone`.
*/
function tzTokenizeDate(date, timeZone) {
	const dtf = getDateTimeFormat(timeZone);
	return "formatToParts" in dtf ? partsOffset(dtf, date) : hackyOffset(dtf, date);
}
var typeToPos = {
	year: 0,
	month: 1,
	day: 2,
	hour: 3,
	minute: 4,
	second: 5
};
function partsOffset(dtf, date) {
	try {
		const formatted = dtf.formatToParts(date);
		const filled = [];
		for (let i = 0; i < formatted.length; i++) {
			const pos = typeToPos[formatted[i].type];
			if (pos !== void 0) filled[pos] = parseInt(formatted[i].value, 10);
		}
		return filled;
	} catch (error) {
		if (error instanceof RangeError) return [NaN];
		throw error;
	}
}
function hackyOffset(dtf, date) {
	const formatted = dtf.format(date);
	const parsed = /(\d+)\/(\d+)\/(\d+),? (\d+):(\d+):(\d+)/.exec(formatted);
	return [
		parseInt(parsed[3], 10),
		parseInt(parsed[1], 10),
		parseInt(parsed[2], 10),
		parseInt(parsed[4], 10),
		parseInt(parsed[5], 10),
		parseInt(parsed[6], 10)
	];
}
var dtfCache = {};
var testDateFormatted = new Intl.DateTimeFormat("en-US", {
	hourCycle: "h23",
	timeZone: "America/New_York",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit"
}).format(/* @__PURE__ */ new Date("2014-06-25T04:00:00.123Z"));
var hourCycleSupported = testDateFormatted === "06/25/2014, 00:00:00" || testDateFormatted === "‎06‎/‎25‎/‎2014‎ ‎00‎:‎00‎:‎00";
function getDateTimeFormat(timeZone) {
	if (!dtfCache[timeZone]) dtfCache[timeZone] = hourCycleSupported ? new Intl.DateTimeFormat("en-US", {
		hourCycle: "h23",
		timeZone,
		year: "numeric",
		month: "numeric",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit"
	}) : new Intl.DateTimeFormat("en-US", {
		hour12: false,
		timeZone,
		year: "numeric",
		month: "numeric",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit"
	});
	return dtfCache[timeZone];
}
// node_modules/date-fns-tz/dist/esm/_lib/newDateUTC/index.js
/**
* Use instead of `new Date(Date.UTC(...))` to support years below 100 which doesn't work
* otherwise due to the nature of the
* [`Date` constructor](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date#interpretation_of_two-digit_years.
*
* For `Date.UTC(...)`, use `newDateUTC(...).getTime()`.
*/
function newDateUTC(fullYear, month, day, hour, minute, second, millisecond) {
	const utcDate = /* @__PURE__ */ new Date(0);
	utcDate.setUTCFullYear(fullYear, month, day);
	utcDate.setUTCHours(hour, minute, second, millisecond);
	return utcDate;
}
// node_modules/date-fns-tz/dist/esm/_lib/tzParseTimezone/index.js
var MILLISECONDS_IN_HOUR$1 = 36e5;
var MILLISECONDS_IN_MINUTE$1 = 6e4;
var patterns$1 = {
	timezone: /([Z+-].*)$/,
	timezoneZ: /^(Z)$/,
	timezoneHH: /^([+-]\d{2})$/,
	timezoneHHMM: /^([+-])(\d{2}):?(\d{2})$/
};
function tzParseTimezone(timezoneString, date, isUtcDate) {
	if (!timezoneString) return 0;
	let token = patterns$1.timezoneZ.exec(timezoneString);
	if (token) return 0;
	let hours;
	let absoluteOffset;
	token = patterns$1.timezoneHH.exec(timezoneString);
	if (token) {
		hours = parseInt(token[1], 10);
		if (!validateTimezone(hours)) return NaN;
		return -(hours * MILLISECONDS_IN_HOUR$1);
	}
	token = patterns$1.timezoneHHMM.exec(timezoneString);
	if (token) {
		hours = parseInt(token[2], 10);
		const minutes = parseInt(token[3], 10);
		if (!validateTimezone(hours, minutes)) return NaN;
		absoluteOffset = Math.abs(hours) * MILLISECONDS_IN_HOUR$1 + minutes * MILLISECONDS_IN_MINUTE$1;
		return token[1] === "+" ? -absoluteOffset : absoluteOffset;
	}
	if (isValidTimezoneIANAString(timezoneString)) {
		date = new Date(date || Date.now());
		const offset = calcOffset(isUtcDate ? date : toUtcDate(date), timezoneString);
		return -(isUtcDate ? offset : fixOffset(date, offset, timezoneString));
	}
	return NaN;
}
function toUtcDate(date) {
	return newDateUTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
}
function calcOffset(date, timezoneString) {
	const tokens = tzTokenizeDate(date, timezoneString);
	const asUTC = newDateUTC(tokens[0], tokens[1] - 1, tokens[2], tokens[3] % 24, tokens[4], tokens[5], 0).getTime();
	let asTS = date.getTime();
	const over = asTS % 1e3;
	asTS -= over >= 0 ? over : 1e3 + over;
	return asUTC - asTS;
}
function fixOffset(date, offset, timezoneString) {
	let utcGuess = date.getTime() - offset;
	const o2 = calcOffset(new Date(utcGuess), timezoneString);
	if (offset === o2) return offset;
	utcGuess -= o2 - offset;
	const o3 = calcOffset(new Date(utcGuess), timezoneString);
	if (o2 === o3) return o2;
	return Math.max(o2, o3);
}
function validateTimezone(hours, minutes) {
	return -23 <= hours && hours <= 23 && (minutes == null || 0 <= minutes && minutes <= 59);
}
var validIANATimezoneCache = {};
function isValidTimezoneIANAString(timeZoneString) {
	if (validIANATimezoneCache[timeZoneString]) return true;
	try {
		new Intl.DateTimeFormat(void 0, { timeZone: timeZoneString });
		validIANATimezoneCache[timeZoneString] = true;
		return true;
	} catch (error) {
		return false;
	}
}
// node_modules/date-fns-tz/dist/esm/_lib/getTimezoneOffsetInMilliseconds/index.js
/**
* Google Chrome as of 67.0.3396.87 introduced timezones with offset that includes seconds.
* They usually appear for dates that denote time before the timezones were introduced
* (e.g. for 'Europe/Prague' timezone the offset is GMT+00:57:44 before 1 October 1891
* and GMT+01:00:00 after that date)
*
* Date#getTimezoneOffset returns the offset in minutes and would return 57 for the example above,
* which would lead to incorrect calculations.
*
* This function returns the timezone offset in milliseconds that takes seconds in account.
*/
function getTimezoneOffsetInMilliseconds(date) {
	const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()));
	utcDate.setUTCFullYear(date.getFullYear());
	return +date - +utcDate;
}
// node_modules/date-fns-tz/dist/esm/_lib/tzPattern/index.js
/** Regex to identify the presence of a time zone specifier in a date string */
var tzPattern = /(Z|[+-]\d{2}(?::?\d{2})?| UTC| [a-zA-Z]+\/[a-zA-Z_]+(?:\/[a-zA-Z_]+)?)$/;
// node_modules/date-fns-tz/dist/esm/toDate/index.js
var MILLISECONDS_IN_HOUR = 36e5;
var MILLISECONDS_IN_MINUTE = 6e4;
var DEFAULT_ADDITIONAL_DIGITS = 2;
var patterns = {
	dateTimePattern: /^([0-9W+-]+)(T| )(.*)/,
	datePattern: /^([0-9W+-]+)(.*)/,
	plainTime: /:/,
	YY: /^(\d{2})$/,
	YYY: [
		/^([+-]\d{2})$/,
		/^([+-]\d{3})$/,
		/^([+-]\d{4})$/
	],
	YYYY: /^(\d{4})/,
	YYYYY: [
		/^([+-]\d{4})/,
		/^([+-]\d{5})/,
		/^([+-]\d{6})/
	],
	MM: /^-(\d{2})$/,
	DDD: /^-?(\d{3})$/,
	MMDD: /^-?(\d{2})-?(\d{2})$/,
	Www: /^-?W(\d{2})$/,
	WwwD: /^-?W(\d{2})-?(\d{1})$/,
	HH: /^(\d{2}([.,]\d*)?)$/,
	HHMM: /^(\d{2}):?(\d{2}([.,]\d*)?)$/,
	HHMMSS: /^(\d{2}):?(\d{2}):?(\d{2}([.,]\d*)?)$/,
	timeZone: tzPattern
};
/**
* @name toDate
* @category Common Helpers
* @summary Convert the given argument to an instance of Date.
*
* @description
* Convert the given argument to an instance of Date.
*
* If the argument is an instance of Date, the function returns its clone.
*
* If the argument is a number, it is treated as a timestamp.
*
* If an argument is a string, the function tries to parse it.
* Function accepts complete ISO 8601 formats as well as partial implementations.
* ISO 8601: http://en.wikipedia.org/wiki/ISO_8601
* If the function cannot parse the string or the values are invalid, it returns Invalid Date.
*
* If the argument is none of the above, the function returns Invalid Date.
*
* **Note**: *all* Date arguments passed to any *date-fns* function is processed by `toDate`.
* All *date-fns* functions will throw `RangeError` if `options.additionalDigits` is not 0, 1, 2 or undefined.
*
* @param argument the value to convert
* @param options the object with options. See [Options]{@link https://date-fns.org/docs/Options}
* @param {0|1|2} [options.additionalDigits=2] - the additional number of digits in the extended year format
* @param {string} [options.timeZone=''] - used to specify the IANA time zone offset of a date String.
*
* @returns the parsed date in the local time zone
* @throws {TypeError} 1 argument required
* @throws {RangeError} `options.additionalDigits` must be 0, 1 or 2
*
* @example
* // Convert string '2014-02-11T11:30:30' to date:
* const result = toDate('2014-02-11T11:30:30')
* //=> Tue Feb 11 2014 11:30:30
*
* @example
* // Convert string '+02014101' to date,
* // if the additional number of digits in the extended year format is 1:
* const result = toDate('+02014101', {additionalDigits: 1})
* //=> Fri Apr 11 2014 00:00:00
*/
function toDate(argument, options = {}) {
	if (arguments.length < 1) throw new TypeError("1 argument required, but only " + arguments.length + " present");
	if (argument === null) return /* @__PURE__ */ new Date(NaN);
	const additionalDigits = options.additionalDigits == null ? DEFAULT_ADDITIONAL_DIGITS : Number(options.additionalDigits);
	if (additionalDigits !== 2 && additionalDigits !== 1 && additionalDigits !== 0) throw new RangeError("additionalDigits must be 0, 1 or 2");
	if (argument instanceof Date || typeof argument === "object" && Object.prototype.toString.call(argument) === "[object Date]") return new Date(argument.getTime());
	else if (typeof argument === "number" || Object.prototype.toString.call(argument) === "[object Number]") return new Date(argument);
	else if (!(Object.prototype.toString.call(argument) === "[object String]")) return /* @__PURE__ */ new Date(NaN);
	const dateStrings = splitDateString(argument);
	const { year, restDateString } = parseYear(dateStrings.date, additionalDigits);
	const date = parseDate(restDateString, year);
	if (date === null || isNaN(date.getTime())) return /* @__PURE__ */ new Date(NaN);
	if (date) {
		const timestamp = date.getTime();
		let time = 0;
		let offset;
		if (dateStrings.time) {
			time = parseTime(dateStrings.time);
			if (time === null || isNaN(time)) return /* @__PURE__ */ new Date(NaN);
		}
		if (dateStrings.timeZone || options.timeZone) {
			offset = tzParseTimezone(dateStrings.timeZone || options.timeZone, new Date(timestamp + time));
			if (isNaN(offset)) return /* @__PURE__ */ new Date(NaN);
		} else {
			offset = getTimezoneOffsetInMilliseconds(new Date(timestamp + time));
			offset = getTimezoneOffsetInMilliseconds(new Date(timestamp + time + offset));
		}
		return new Date(timestamp + time + offset);
	} else return /* @__PURE__ */ new Date(NaN);
}
function splitDateString(dateString) {
	const dateStrings = {};
	let parts = patterns.dateTimePattern.exec(dateString);
	let timeString;
	if (!parts) {
		parts = patterns.datePattern.exec(dateString);
		if (parts) {
			dateStrings.date = parts[1];
			timeString = parts[2];
		} else {
			dateStrings.date = null;
			timeString = dateString;
		}
	} else {
		dateStrings.date = parts[1];
		timeString = parts[3];
	}
	if (timeString) {
		const token = patterns.timeZone.exec(timeString);
		if (token) {
			dateStrings.time = timeString.replace(token[1], "");
			dateStrings.timeZone = token[1].trim();
		} else dateStrings.time = timeString;
	}
	return dateStrings;
}
function parseYear(dateString, additionalDigits) {
	if (dateString) {
		const patternYYY = patterns.YYY[additionalDigits];
		const patternYYYYY = patterns.YYYYY[additionalDigits];
		let token = patterns.YYYY.exec(dateString) || patternYYYYY.exec(dateString);
		if (token) {
			const yearString = token[1];
			return {
				year: parseInt(yearString, 10),
				restDateString: dateString.slice(yearString.length)
			};
		}
		token = patterns.YY.exec(dateString) || patternYYY.exec(dateString);
		if (token) {
			const centuryString = token[1];
			return {
				year: parseInt(centuryString, 10) * 100,
				restDateString: dateString.slice(centuryString.length)
			};
		}
	}
	return { year: null };
}
function parseDate(dateString, year) {
	if (year === null) return null;
	let date;
	let month;
	let week;
	if (!dateString || !dateString.length) {
		date = /* @__PURE__ */ new Date(0);
		date.setUTCFullYear(year);
		return date;
	}
	let token = patterns.MM.exec(dateString);
	if (token) {
		date = /* @__PURE__ */ new Date(0);
		month = parseInt(token[1], 10) - 1;
		if (!validateDate(year, month)) return /* @__PURE__ */ new Date(NaN);
		date.setUTCFullYear(year, month);
		return date;
	}
	token = patterns.DDD.exec(dateString);
	if (token) {
		date = /* @__PURE__ */ new Date(0);
		const dayOfYear = parseInt(token[1], 10);
		if (!validateDayOfYearDate(year, dayOfYear)) return /* @__PURE__ */ new Date(NaN);
		date.setUTCFullYear(year, 0, dayOfYear);
		return date;
	}
	token = patterns.MMDD.exec(dateString);
	if (token) {
		date = /* @__PURE__ */ new Date(0);
		month = parseInt(token[1], 10) - 1;
		const day = parseInt(token[2], 10);
		if (!validateDate(year, month, day)) return /* @__PURE__ */ new Date(NaN);
		date.setUTCFullYear(year, month, day);
		return date;
	}
	token = patterns.Www.exec(dateString);
	if (token) {
		week = parseInt(token[1], 10) - 1;
		if (!validateWeekDate(week)) return /* @__PURE__ */ new Date(NaN);
		return dayOfISOWeekYear(year, week);
	}
	token = patterns.WwwD.exec(dateString);
	if (token) {
		week = parseInt(token[1], 10) - 1;
		const dayOfWeek = parseInt(token[2], 10) - 1;
		if (!validateWeekDate(week, dayOfWeek)) return /* @__PURE__ */ new Date(NaN);
		return dayOfISOWeekYear(year, week, dayOfWeek);
	}
	return null;
}
function parseTime(timeString) {
	let hours;
	let minutes;
	let token = patterns.HH.exec(timeString);
	if (token) {
		hours = parseFloat(token[1].replace(",", "."));
		if (!validateTime(hours)) return NaN;
		return hours % 24 * MILLISECONDS_IN_HOUR;
	}
	token = patterns.HHMM.exec(timeString);
	if (token) {
		hours = parseInt(token[1], 10);
		minutes = parseFloat(token[2].replace(",", "."));
		if (!validateTime(hours, minutes)) return NaN;
		return hours % 24 * MILLISECONDS_IN_HOUR + minutes * MILLISECONDS_IN_MINUTE;
	}
	token = patterns.HHMMSS.exec(timeString);
	if (token) {
		hours = parseInt(token[1], 10);
		minutes = parseInt(token[2], 10);
		const seconds = parseFloat(token[3].replace(",", "."));
		if (!validateTime(hours, minutes, seconds)) return NaN;
		return hours % 24 * MILLISECONDS_IN_HOUR + minutes * MILLISECONDS_IN_MINUTE + seconds * 1e3;
	}
	return null;
}
function dayOfISOWeekYear(isoWeekYear, week, day) {
	week = week || 0;
	day = day || 0;
	const date = /* @__PURE__ */ new Date(0);
	date.setUTCFullYear(isoWeekYear, 0, 4);
	const fourthOfJanuaryDay = date.getUTCDay() || 7;
	const diff = week * 7 + day + 1 - fourthOfJanuaryDay;
	date.setUTCDate(date.getUTCDate() + diff);
	return date;
}
var DAYS_IN_MONTH = [
	31,
	28,
	31,
	30,
	31,
	30,
	31,
	31,
	30,
	31,
	30,
	31
];
var DAYS_IN_MONTH_LEAP_YEAR = [
	31,
	29,
	31,
	30,
	31,
	30,
	31,
	31,
	30,
	31,
	30,
	31
];
function isLeapYearIndex(year) {
	return year % 400 === 0 || year % 4 === 0 && year % 100 !== 0;
}
function validateDate(year, month, date) {
	if (month < 0 || month > 11) return false;
	if (date != null) {
		if (date < 1) return false;
		const isLeapYear = isLeapYearIndex(year);
		if (isLeapYear && date > DAYS_IN_MONTH_LEAP_YEAR[month]) return false;
		if (!isLeapYear && date > DAYS_IN_MONTH[month]) return false;
	}
	return true;
}
function validateDayOfYearDate(year, dayOfYear) {
	if (dayOfYear < 1) return false;
	const isLeapYear = isLeapYearIndex(year);
	if (isLeapYear && dayOfYear > 366) return false;
	if (!isLeapYear && dayOfYear > 365) return false;
	return true;
}
function validateWeekDate(week, day) {
	if (week < 0 || week > 52) return false;
	if (day != null && (day < 0 || day > 6)) return false;
	return true;
}
function validateTime(hours, minutes, seconds) {
	if (hours < 0 || hours >= 25) return false;
	if (minutes != null && (minutes < 0 || minutes >= 60)) return false;
	if (seconds != null && (seconds < 0 || seconds >= 60)) return false;
	return true;
}
// node_modules/date-fns-tz/dist/esm/fromZonedTime/index.js
/**
* @name fromZonedTime
* @category Time Zone Helpers
* @summary Get the UTC date/time from a date representing local time in a given time zone
*
* @description
* Returns a date instance with the UTC time of the provided date of which the values
* represented the local time in the time zone specified. In other words, if the input
* date represented local time in time zone, the timestamp of the output date will
* give the equivalent UTC of that local time regardless of the current system time zone.
*
* @param date the date with values representing the local time
* @param timeZone the time zone of this local time, can be an offset or IANA time zone
* @param options the object with options. See [Options]{@link https://date-fns.org/docs/Options}
* @param {0|1|2} [options.additionalDigits=2] - passed to `toDate`. See [toDate]{@link https://date-fns.org/docs/toDate}
* @throws {TypeError} 2 arguments required
* @throws {RangeError} `options.additionalDigits` must be 0, 1 or 2
*
* @example
* // In June 10am in Los Angeles is 5pm UTC
* const result = fromZonedTime(new Date(2014, 5, 25, 10, 0, 0), 'America/Los_Angeles')
* //=> 2014-06-25T17:00:00.000Z
*/
function fromZonedTime(date, timeZone, options) {
	if (typeof date === "string" && !date.match(tzPattern)) return toDate(date, {
		...options,
		timeZone
	});
	date = toDate(date, options);
	const utc = newDateUTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()).getTime();
	const offsetMilliseconds = tzParseTimezone(timeZone, new Date(utc));
	return new Date(utc + offsetMilliseconds);
}
// src/core/dates.ts
var OSLO_TIME_ZONE = "Europe/Oslo";
var osloDateFormatter = new Intl.DateTimeFormat("en-CA", {
	timeZone: OSLO_TIME_ZONE,
	year: "numeric",
	month: "2-digit",
	day: "2-digit"
});
var osloDateTimeFormatter = new Intl.DateTimeFormat("nb-NO", {
	timeZone: OSLO_TIME_ZONE,
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit"
});
function osloDateString(value = /* @__PURE__ */ new Date()) {
	return osloDateFormatter.format(value);
}
function osloDateTimeString(value) {
	return osloDateTimeFormatter.format(value);
}
function osloParts(value) {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: OSLO_TIME_ZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		weekday: "short",
		hour12: false
	}).formatToParts(value);
	const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
	return {
		year: Number(get("year")),
		month: Number(get("month")),
		day: Number(get("day")),
		hour: Number(get("hour")),
		minute: Number(get("minute")),
		weekday: {
			Sun: 0,
			Mon: 1,
			Tue: 2,
			Wed: 3,
			Thu: 4,
			Fri: 5,
			Sat: 6
		}[get("weekday")] ?? 0
	};
}
function fromOsloDate(dateString, hour, minute) {
	return fromZonedTime(`${dateString}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`, OSLO_TIME_ZONE);
}
function addDaysToDateString(dateString, days) {
	const [year, month, day] = dateString.split("-").map(Number);
	return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
function weekdayOfDateString(dateString) {
	const [year, month, day] = dateString.split("-").map(Number);
	return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
function isWeekendDay(weekday) {
	return weekday === 0 || weekday === 6;
}
var FIXED_MARKET_HOLIDAYS = /* @__PURE__ */ new Set([
	"01-01",
	"05-01",
	"05-17",
	"12-24",
	"12-25",
	"12-26",
	"12-31"
]);
/** Movable feasts are counted as days from Easter Sunday. */
var EASTER_MARKET_HOLIDAYS = /* @__PURE__ */ new Set([
	-3,
	-2,
	1,
	39,
	50
]);
/** Easter Sunday in the Gregorian calendar (Meeus/Jones/Butcher). */
function easterSunday(year) {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	return {
		month: Math.floor((h + l - 7 * m + 114) / 31),
		day: (h + l - 7 * m + 114) % 31 + 1
	};
}
/** True when Oslo Børs is closed for a public holiday on this date. */
function isOsloMarketHoliday(dateString) {
	const [year, month, day] = dateString.split("-").map(Number);
	const key = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
	if (FIXED_MARKET_HOLIDAYS.has(key)) return true;
	const easter = easterSunday(year);
	const easterUtc = Date.UTC(year, easter.month - 1, easter.day);
	const dateUtc = Date.UTC(year, month - 1, day);
	const daysFromEaster = Math.round((dateUtc - easterUtc) / 864e5);
	return EASTER_MARKET_HOLIDAYS.has(daysFromEaster);
}
/** True when Oslo Børs has a trading day on this date. */
function isOsloMarketOpenDay(dateString) {
	if (isWeekendDay(weekdayOfDateString(dateString))) return false;
	return !isOsloMarketHoliday(dateString);
}
function daysUntil(dateString, today) {
	if (dateString === null) return null;
	const [year, month, day] = dateString.split("-").map(Number);
	const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
	const target = Date.UTC(year, month - 1, day);
	const current = Date.UTC(todayYear, todayMonth - 1, todayDay);
	return Math.round((target - current) / 864e5);
}
function currentSessionOpen(now = /* @__PURE__ */ new Date()) {
	if (!isOsloMarketOpenDay(osloDateString(now))) return null;
	const open = fromOsloDate(osloDateString(now), 9, 0);
	return now >= open ? open : null;
}
function fixed(value, digits) {
	return value.toFixed(digits).replace(".", ",");
}
function formatPct(value, digits = 1, signed = true) {
	if (value === null) return "–";
	let text = fixed(value * 100, digits);
	if (signed && value > 0) text = `+${text}`;
	return `${text} %`;
}
function formatNumber(value, digits = 0) {
	if (value === null) return "–";
	const [whole, fraction] = value.toFixed(digits).split(".");
	const withSpaces = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
	return fraction === void 0 ? withSpaces : `${withSpaces},${fraction}`;
}
function formatMoney(value, digits = 0, signed = false) {
	if (value === null) return "–";
	let text = formatNumber(value, digits);
	if (signed && value > 0) text = `+${text}`;
	return `${text} kr`;
}
function formatMarketCap(value) {
	if (value === null) return "–";
	const magnitude = Math.abs(value);
	if (magnitude >= 0xe8d4a51000) return `${fixed(value / 0xe8d4a51000, 1)} bill.`;
	if (magnitude >= 1e9) return `${fixed(value / 1e9, 1)} mrd.`;
	if (magnitude >= 1e6) return `${fixed(value / 1e6, 0)} mill.`;
	if (magnitude >= 1e3) return `${fixed(value / 1e3, 0)} k`;
	return fixed(value, 0);
}
function formatDateTime(value) {
	return osloDateTimeString(value);
}
// src/core/session.ts
/** Oslo Børs is open 09:00–16:30 on trading days (weekdays without holidays). */
function marketSession(now = /* @__PURE__ */ new Date()) {
	const parts = osloParts(now);
	if (!isOsloMarketOpenDay(osloDateString(now))) return "closed";
	const minutes = parts.hour * 60 + parts.minute;
	if (minutes < 540) return "pre";
	if (minutes <= 990) return "open";
	return "closed";
}
/**
* True once the Oslo session has been open for the simulator's warm-up delay.
* The cron job also gates on 09:05 Oslo time; this keeps a manual or retried
* tick from trading on the previous close at 09:00.
*/
function simulatorMayTick(now = /* @__PURE__ */ new Date()) {
	if (marketSession(now) !== "open") return false;
	const parts = osloParts(now);
	return parts.hour * 60 + parts.minute >= 545;
}
// src/core/types.ts
function turnover(stock) {
	if (stock.volume === null) return null;
	return stock.close * stock.volume;
}
function averageTurnover(stock) {
	if (stock.averageVolume10d === null) return null;
	return stock.close * stock.averageVolume10d;
}
function atrPct(stock) {
	if (stock.atr === null || stock.close <= 0) return null;
	return stock.atr / stock.close;
}
function emptyNewsSignal() {
	return {
		sentiment: "neutral",
		relevance: "low",
		eventType: "other",
		count: 0,
		latestTitle: ""
	};
}
function isRelevantSignal(signal) {
	return signal.count > 0 && (signal.relevance === "high" || signal.relevance === "medium");
}
function isNegativeSignal(signal) {
	return signal.sentiment === "negative" || signal.sentiment === "mixed";
}
// src/core/news.ts
var NEWS_MESSAGE_URL = "https://newsweb.oslobors.no/message/{message_id}";
var NewsSourceError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "NewsSourceError";
	}
};
var NORWEGIAN_HINTS = [
	" og ",
	" av ",
	" for ",
	" til ",
	" på ",
	" med ",
	" er ",
	" ikke ",
	" ny ",
	" nye ",
	" kvartal",
	" rapport",
	" resultat",
	" avtale",
	" kjøp",
	" salg",
	" oppkjøp",
	" kontrakt",
	" tildelt",
	" leverer",
	" sterk",
	" vekst",
	" utbytte",
	" emisjon",
	" meldepliktig",
	" primærinnsider",
	" nærstående",
	" egne aksjer",
	" ansatt"
];
var POSITIVE_STRONG = [
	String.raw`\brekord`,
	String.raw`\boverskudd`,
	String.raw`\bprofitt`,
	String.raw`\boppkjøp`,
	String.raw`\bkontrakt`,
	String.raw`\btildelt`,
	String.raw`\bsterk`,
	String.raw`\blønnsom`,
	String.raw`\bvekst`,
	String.raw`\bacqui`,
	String.raw`\brecords?\b`,
	String.raw`\bprofit`,
	String.raw`\bcontract`,
	String.raw`\bawarded`,
	String.raw`\bstrong(?:er|est)?\b`,
	String.raw`\bgrowth\b`,
	String.raw`\bbeat\b`,
	String.raw`\braised\b`,
	String.raw`\bupgrade`
];
var POSITIVE_WEAK = [
	String.raw`\bgod\b`,
	String.raw`\bgode\b`,
	String.raw`\bavtale`,
	String.raw`\bagreement`,
	String.raw`\bkjøp`,
	String.raw`\bpurchase`,
	String.raw`\binngår`,
	String.raw`\bvinner`,
	String.raw`\bwins\b`,
	String.raw`\butbytte`,
	String.raw`\bdividend`,
	String.raw`\bbuyback`,
	String.raw`\brepurchase`,
	String.raw`\bimproved\b`,
	String.raw`\bsolid\b`,
	String.raw`\bexpands\b`,
	String.raw`\bdoubling\b`,
	String.raw`\bordre`,
	String.raw`\border`,
	String.raw`\bbacklog\b`
];
var NEGATIVE_STRONG = [
	String.raw`\btap\b`,
	String.raw`\bunderskudd`,
	String.raw`\bkutt\b`,
	String.raw`\bkutter`,
	String.raw`\bvarsel`,
	String.raw`\bstreik`,
	String.raw`\bsøksmål`,
	String.raw`\bgransking`,
	String.raw`\betterforskning`,
	String.raw`\bnedgrader`,
	String.raw`\bkonkurs`,
	String.raw`\bnedskrivning`,
	String.raw`\bloss\b`,
	String.raw`\bwarning`,
	String.raw`\blawsuit`,
	String.raw`\binvestigation`,
	String.raw`\bdowngrade`,
	String.raw`\bimpairment`,
	String.raw`\blayoff`,
	String.raw`\bfraud`,
	String.raw`\bplunge`
];
var NEGATIVE_WEAK = [
	String.raw`\bfall`,
	String.raw`\bnedgang`,
	String.raw`\bsvak`,
	String.raw`\bselger`,
	String.raw`\bsalg\b`,
	String.raw`\bavslutt`,
	String.raw`\bkanseller`,
	String.raw`\butsett`,
	String.raw`\bforsink`,
	String.raw`\bproblem`,
	String.raw`\bfeil\b`,
	String.raw`\bemisjon`,
	String.raw`\bdecline`,
	String.raw`\bweak`,
	String.raw`\bcut\b`,
	String.raw`\bdelay`,
	String.raw`\bterminates`,
	String.raw`\bmiss\b`,
	String.raw`\bdrop\b`,
	String.raw`\blowered`,
	String.raw`\bsenker`
];
var CAPITAL_RAISE = [
	String.raw`\bemisjon`,
	String.raw`\brettet\s+emisjon`,
	String.raw`\bkapitalinnhenting`,
	String.raw`\bprivate\s+placement`,
	String.raw`\brights?\s+issue`,
	String.raw`\bcapital\s+raise`,
	String.raw`\bshare\s+issue`,
	String.raw`\bny\s+aksjekapital`
];
var RESULT = [
	String.raw`\bkvartalsrapport`,
	String.raw`\bhalvårsrapport`,
	String.raw`\bårsrapport`,
	String.raw`\bquarterly\s+(?:report|results?)`,
	String.raw`\bannual\s+report`,
	String.raw`\binterim\s+report`,
	String.raw`\bq[1-4]\s*(?:20\d{2}|rapport|report)`,
	String.raw`\bresultat(?:varsel|rapport)?\b`
];
var CONTRACT = [
	String.raw`\bkontrakt`,
	String.raw`\bcontract`,
	String.raw`\bordre\b`,
	String.raw`\border\b`,
	String.raw`\btildelt`,
	String.raw`\bawarded`,
	String.raw`\bbacklog`,
	String.raw`\bavtale`,
	String.raw`\bagreement`
];
var INSIDER = [
	String.raw`\bprimærinnsider`,
	String.raw`\binnsider`,
	String.raw`\binsider`,
	String.raw`\bmeldepliktig\s+handel`,
	String.raw`\bmandatory\s+notification\s+of\s+trade`
];
var ACQUISITION = [
	String.raw`\boppkjøp`,
	String.raw`\bacquisition`,
	String.raw`\bfusjon`,
	String.raw`\bmerger`,
	String.raw`\bdivest`,
	String.raw`\bsalg\s+av\s+virksomhet`,
	String.raw`\bstrategisk`,
	String.raw`\bstrategic`
];
var DIVIDEND = [
	String.raw`\butbytte`,
	String.raw`\bdividend`,
	String.raw`\bex[- ]?dato`,
	String.raw`\bex[- ]?date`
];
var LOW_RELEVANCE = [
	String.raw`\bfinancial\s+calendar`,
	String.raw`\bfinansiell\s+kalender`,
	String.raw`\bkalender`,
	String.raw`\bpresentasjon`,
	String.raw`\bpresentation`,
	String.raw`\binvitasjon`,
	String.raw`\binvitation`
];
function keywordScore(title, patterns, weight) {
	return patterns.reduce((score, pattern) => score + (new RegExp(pattern, "i").test(title) ? weight : 0), 0);
}
function matches(text, patterns) {
	return patterns.some((pattern) => new RegExp(pattern, "i").test(text));
}
function classifySentiment(title) {
	const text = String(title ?? "").replace(/\s+/g, " ").trim();
	if (!text) return "neutral";
	if (/\bprofit\s+warning\b/i.test(text)) return "negative";
	const positive = keywordScore(text, POSITIVE_STRONG, 2) + keywordScore(text, POSITIVE_WEAK, 1);
	const negative = keywordScore(text, NEGATIVE_STRONG, 2) + keywordScore(text, NEGATIVE_WEAK, 1);
	if (positive >= 2 && positive > negative) return "positive";
	if (negative >= 2 && negative > positive) return "negative";
	return "neutral";
}
function classifyNews(title, category = "") {
	const text = String(title ?? "").replace(/\s+/g, " ").trim();
	const context = `${text} ${category}`.trim();
	if (!context) return {
		sentiment: "neutral",
		eventType: "other",
		relevance: "low"
	};
	let sentiment = classifySentiment(text);
	let eventType = "other";
	let relevance = "low";
	if (matches(context, CAPITAL_RAISE)) {
		eventType = "capital_raise";
		relevance = "high";
		sentiment = "negative";
	} else if (/\bprofit\s+warning\b|\bresultatvarsel\b/i.test(context)) {
		eventType = "result";
		relevance = "high";
		sentiment = "negative";
	} else if (matches(context, RESULT)) {
		eventType = "result";
		relevance = "high";
	} else if (matches(context, CONTRACT)) {
		eventType = "contract";
		relevance = matches(context, [
			String.raw`\btildelt`,
			String.raw`\bawarded`,
			String.raw`\bkontrakt`,
			String.raw`\bcontract`,
			String.raw`\bordre\b`
		]) ? "high" : "medium";
	} else if (matches(context, INSIDER)) {
		eventType = "insider";
		relevance = "high";
		if (/\bsalg\b|\bselger\b|\bsold\b|\bsale\b/i.test(context)) sentiment = "negative";
		else if (/\bkjøp\b|\bkjøper\b|\bbought\b|\bpurchase\b/i.test(context)) sentiment = "positive";
	} else if (matches(context, ACQUISITION)) {
		eventType = "acquisition";
		relevance = "high";
	} else if (matches(context, DIVIDEND)) {
		eventType = "dividend";
		relevance = "medium";
	}
	if (matches(context, LOW_RELEVANCE)) relevance = "low";
	if (eventType === "other" && (sentiment === "positive" || sentiment === "negative")) relevance = "medium";
	return {
		sentiment,
		eventType,
		relevance
	};
}
function tickerKey(value) {
	return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function nameKey(value) {
	return String(value ?? "").toLocaleLowerCase("nb-NO").replace(/\b(asa|as|a\/s|plc|ab|oy|oyj)\b/g, " ").replace(/[^a-z0-9æøå]+/g, "");
}
function publishedAt(value) {
	if (typeof value !== "string" || !value.trim()) return null;
	const text = value.trim().replace("Z", "+00:00");
	const parsed = new Date(text);
	if (Number.isNaN(parsed.getTime())) return null;
	return parsed;
}
function categoryOf(message) {
	const categories = message.category;
	if (!Array.isArray(categories) || categories.length === 0) return "";
	const first = categories[0];
	if (!first || typeof first !== "object") return "";
	const record = first;
	return String(record.category_no ?? record.category_en ?? "").trim();
}
function cleanTitle(value) {
	return String(value ?? "").replace(/\s+/g, " ").trim();
}
function norwegianScore(title) {
	const text = ` ${title.toLocaleLowerCase("nb-NO")} `;
	let score = NORWEGIAN_HINTS.reduce((sum, hint) => sum + (text.includes(hint) ? 1 : 0), 0);
	if (/[æøå]/.test(text)) score += 2;
	return score;
}
function uniqueNews(items, limit) {
	const best = /* @__PURE__ */ new Map();
	for (const item of items) {
		const key = `${item.publishedAt.toISOString().slice(0, 16)}|${item.sentiment}|${item.eventType}`;
		const current = best.get(key);
		if (!current || norwegianScore(item.title) > norwegianScore(current.title)) best.set(key, item);
	}
	const ordered = Array.from(best.values()).sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
	return limit === void 0 ? ordered : ordered.slice(0, limit);
}
function aggregateSentiment(items) {
	const unique = uniqueNews(items);
	const positive = unique.filter((item) => item.sentiment === "positive").length;
	const negative = unique.filter((item) => item.sentiment === "negative").length;
	if (positive > 0 && negative > 0) return "mixed";
	if (positive > 0) return "positive";
	if (negative > 0) return "negative";
	return "neutral";
}
var EVENT_PRIORITY = {
	capital_raise: 6,
	result: 5,
	contract: 4,
	insider: 3,
	acquisition: 2,
	dividend: 1,
	other: 0
};
function aggregateNewsSignal(items) {
	const unique = uniqueNews(items);
	if (unique.length === 0) return emptyNewsSignal();
	const relevanceRank = {
		low: 0,
		medium: 1,
		high: 2
	};
	const relevance = unique.reduce((best, item) => relevanceRank[item.relevance] > relevanceRank[best] ? item.relevance : best, "low");
	const negative = unique.filter((item) => item.sentiment === "negative" && (item.relevance === "high" || item.relevance === "medium"));
	const eventType = (negative.length > 0 ? negative : unique).reduce((best, item) => EVENT_PRIORITY[item.eventType] > EVENT_PRIORITY[best] ? item.eventType : best, "other");
	return {
		sentiment: aggregateSentiment(unique),
		relevance,
		eventType,
		count: unique.length,
		latestTitle: unique[0].title
	};
}
function forStock(feed, stock) {
	return feed.itemsByTicker.get(tickerKey(stock.ticker)) ?? feed.itemsByName.get(nameKey(stock.name)) ?? [];
}
function signalFor(feed, stock) {
	return aggregateNewsSignal(forStock(feed, stock));
}
function parseNewsPayload(payload, since, fetchedAt, source = "live", warning = null) {
	if (!payload || typeof payload !== "object") throw new NewsSourceError("Svar fra NewsWeb mangler 'data'-objektet.");
	const data = payload.data;
	if (!data || typeof data !== "object") throw new NewsSourceError("Svar fra NewsWeb mangler 'data'-objektet.");
	const messages = data.messages;
	if (!Array.isArray(messages)) throw new NewsSourceError("Svar fra NewsWeb mangler 'messages'-listen.");
	let effectiveWarning = warning;
	const byTicker = /* @__PURE__ */ new Map();
	const byName = /* @__PURE__ */ new Map();
	for (const raw of messages) {
		if (!raw || typeof raw !== "object") continue;
		const message = raw;
		const ticker = String(message.issuerSign ?? "").trim().toUpperCase();
		if (!ticker) continue;
		const published = publishedAt(message.publishedTime);
		if (!published || published < since) continue;
		const messageId = Number(message.messageId);
		if (!Number.isFinite(messageId)) continue;
		const title = cleanTitle(message.title);
		if (!title) continue;
		const issuerName = cleanTitle(message.issuerName) || ticker;
		const category = categoryOf(message);
		const classification = classifyNews(title, category);
		const item = {
			ticker,
			issuerName,
			title,
			publishedAt: published,
			category,
			messageId,
			url: NEWS_MESSAGE_URL.replace("{message_id}", String(messageId)),
			sentiment: classification.sentiment,
			eventType: classification.eventType,
			relevance: classification.relevance
		};
		const tKey = tickerKey(ticker);
		const nKey = nameKey(issuerName);
		byTicker.set(tKey, [...byTicker.get(tKey) ?? [], item]);
		byName.set(nKey, [...byName.get(nKey) ?? [], item]);
	}
	const sortGroups = (groups) => new Map(Array.from(groups.entries()).map(([key, items]) => [key, items.slice().sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())]));
	if (data.overflow && !effectiveWarning) effectiveWarning = "NewsWeb svarte at listen kan være ufullstendig (overflow).";
	return {
		itemsByTicker: sortGroups(byTicker),
		itemsByName: sortGroups(byName),
		fetchedAt,
		since,
		source,
		warning: effectiveWarning,
		sessionOpen: currentSessionOpen(fetchedAt)
	};
}
function emptyNewsFeed(fetchedAt, since, warning) {
	return {
		itemsByTicker: /* @__PURE__ */ new Map(),
		itemsByName: /* @__PURE__ */ new Map(),
		fetchedAt,
		since,
		source: "error",
		warning,
		sessionOpen: currentSessionOpen(fetchedAt)
	};
}
// src/core/strategy.ts
var EPSILON = 1e-9;
function clamp$2(value, low = 0, high = 1) {
	return Math.max(low, Math.min(high, value));
}
function weighted(components, weights) {
	const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
	if (total <= 0) return 0;
	return Object.entries(components).reduce((sum, [name, value]) => sum + (weights[name] ?? 0) * value, 0) / total;
}
function weightsOf(weights) {
	return weights;
}
function isCandidate(stock, config) {
	if (!["stock", "dr"].includes(stock.instrumentType)) return false;
	if (stock.weekReturn === null || stock.weekReturn <= 0) return false;
	if (stock.weekReturn > config.maxWeekReturn) return false;
	if (stock.close < config.minPrice) return false;
	if (stock.sma5 === null || stock.close <= stock.sma5) return false;
	if (stock.sma20 === null || stock.close <= stock.sma20) return false;
	if (stock.monthReturn !== null && stock.monthReturn <= 0) return false;
	if (stock.rsi !== null && stock.rsi > config.maxRsi) return false;
	if (stock.marketCap !== null && stock.marketCap < config.minMarketCap) return false;
	const turnover = averageTurnover(stock);
	if (turnover !== null && turnover < config.minAverageTurnover) return false;
	return true;
}
function median(values) {
	if (values.length === 0) return null;
	const sorted = values.slice().sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[middle];
	return (sorted[middle - 1] + sorted[middle]) / 2;
}
function buildContext(stocks) {
	return {
		medianWeekReturn: median(stocks.map((stock) => stock.weekReturn).filter((value) => value !== null)),
		medianQuarterReturn: median(stocks.map((stock) => stock.quarterReturn).filter((value) => value !== null))
	};
}
function resistance(stock) {
	const values = [stock.high52w, stock.ath].filter((value) => value !== null && value > stock.close);
	return values.length > 0 ? Math.min(...values) : null;
}
function support(stock) {
	const values = [stock.sma20, stock.sma5].filter((value) => value !== null && value < stock.close);
	return values.length > 0 ? Math.max(...values) : null;
}
function volumeRatio(stock) {
	if (!stock.volume || !stock.averageVolume10d || stock.averageVolume10d <= 0) return null;
	return stock.volume / stock.averageVolume10d;
}
function dayShare(stock) {
	const day = stock.dayReturn;
	const week = stock.weekReturn;
	if (day === null || week === null || week <= 0 || day <= 0) return null;
	return day / week;
}
function isSmoothDay(stock, config) {
	const day = stock.dayReturn;
	const share = dayShare(stock);
	return day !== null && day > 0 && day <= config.smoothDayReturn && share !== null && share <= config.smoothDayShare;
}
function isDaySpike(stock, config) {
	const day = stock.dayReturn;
	const share = dayShare(stock);
	return day !== null && share !== null && day >= config.spikeDayReturn && share >= config.spikeDayShare;
}
function consistencyScore(stock, config) {
	const day = stock.dayReturn;
	const week = stock.weekReturn;
	if (day === null || week === null || week <= 0) return .45;
	if (day <= 0) return .65;
	const share = dayShare(stock);
	if (share === null) return .45;
	if (isSmoothDay(stock, config)) return 1;
	if (day >= config.strongSpikeDayReturn) return 0;
	if (isDaySpike(stock, config)) {
		const span = Math.max(config.strongSpikeDayReturn - config.spikeDayReturn, EPSILON);
		return .15 + .2 * clamp$2(1 - (day - config.spikeDayReturn) / span);
	}
	if (day <= config.smoothDayReturn) return .75;
	if (day >= config.spikeDayReturn) return .45;
	if (share >= .75) return .55;
	return .65;
}
function spikeRisk(stock, signal, config) {
	const day = stock.dayReturn;
	if (day === null) return .2;
	if (day <= 0) return 0;
	const share = dayShare(stock) ?? 0;
	let risk;
	if (day >= config.strongSpikeDayReturn) risk = 1;
	else if (isDaySpike(stock, config)) {
		const span = Math.max(config.strongSpikeDayReturn - config.spikeDayReturn, EPSILON);
		risk = .55 + .4 * clamp$2((day - config.spikeDayReturn) / span);
	} else if (day >= config.spikeDayReturn) risk = .3;
	else if (day <= config.smoothDayReturn) risk = share <= config.smoothDayShare ? 0 : .1;
	else risk = .15;
	if (risk <= 0) return 0;
	if (stock.rsi !== null && stock.rsi >= config.overextendedRsi) risk = Math.max(risk, .7);
	if (stock.sma5 !== null && stock.sma5 > 0 && stock.close / stock.sma5 - 1 >= config.spikeSma5Distance) risk = Math.max(risk, .6);
	const ratio = volumeRatio(stock);
	if (isRelevantSignal(signal) && signal.sentiment === "positive" && signal.eventType !== "capital_raise" && ratio !== null && ratio >= 1.5) risk *= .8;
	else if (isRelevantSignal(signal) && signal.sentiment === "negative") risk = Math.min(1, risk + .15);
	return clamp$2(risk);
}
function newsOpportunity(signal) {
	if (signal.count === 0) return .45;
	if (signal.eventType === "capital_raise") return 0;
	if (signal.sentiment === "negative") return 0;
	if (signal.sentiment === "mixed") return .25;
	if (signal.sentiment === "positive") return {
		high: .95,
		medium: .8,
		low: .6
	}[signal.relevance] ?? .5;
	return {
		high: .55,
		medium: .48,
		low: .4
	}[signal.relevance] ?? .4;
}
function newsRisk(signal) {
	if (signal.eventType === "capital_raise") return 1;
	if (signal.sentiment === "negative") return {
		high: 1,
		medium: .75,
		low: .4
	}[signal.relevance] ?? .5;
	if (signal.sentiment === "mixed") return {
		high: .55,
		medium: .4,
		low: .25
	}[signal.relevance] ?? .3;
	return 0;
}
function breakoutStatus(stock, config, _signal) {
	const resistanceValue = resistance(stock);
	const week = stock.weekReturn ?? 0;
	const rsi = stock.rsi;
	const overextended = week > config.overextendedWeek || rsi !== null && rsi >= config.overextendedRsi || isDaySpike(stock, config);
	if (resistanceValue === null) {
		if (overextended || week > .1) return "overstrukket";
		return "mulig";
	}
	if (resistanceValue / stock.close - 1 <= config.breakoutDistance) return overextended ? "overstrukket" : "mulig";
	return "ikke nær";
}
function categories(stock, config, signal, status) {
	const values = [];
	const week = stock.weekReturn ?? 0;
	const month = stock.monthReturn;
	if (week > 0 && (month === null || month > 0) && stock.sma5 !== null && stock.sma20 !== null && stock.close > stock.sma5 && stock.close > stock.sma20 && week <= config.overextendedWeek && (stock.rsi === null || stock.rsi < config.overextendedRsi) && !isDaySpike(stock, config)) values.push("momentum");
	if (status === "mulig") values.push("breakout");
	if (isRelevantSignal(signal) && signal.sentiment === "positive" && signal.eventType !== "capital_raise") values.push("news");
	return values;
}
function opportunityComponents(stock, context, signal, config) {
	const week = stock.weekReturn ?? 0;
	const month = stock.monthReturn;
	let weekScore = clamp$2(week / .08);
	if (week > config.overextendedWeek) weekScore *= Math.max(.25, 1 - (week - config.overextendedWeek) / .1);
	const monthScore = month !== null ? clamp$2(month / .2) : .35;
	const momentum = .7 * weekScore + .3 * monthScore;
	let trend = 0;
	if (stock.sma20 !== null && stock.sma20 > 0) {
		const distance = stock.close / stock.sma20 - 1;
		trend = clamp$2(distance / .08);
		if (distance > .12) trend *= Math.max(.3, 1 - (distance - .12) / .15);
	}
	if (stock.sma5 !== null && stock.sma20 !== null && stock.sma5 > stock.sma20) trend = clamp$2(trend + .12);
	if (stock.sma50 !== null && stock.close > stock.sma50) trend = clamp$2(trend + .12);
	const quarter = stock.quarterReturn;
	let quarterScore;
	if (quarter === null) quarterScore = .4;
	else quarterScore = clamp$2(.5 + (quarter - (context.medianQuarterReturn ?? 0)) / .2);
	const weekRelative = clamp$2(.5 + (week - (context.medianWeekReturn ?? 0)) / .1);
	const relativeStrength = .6 * quarterScore + .4 * weekRelative;
	const turnover = averageTurnover(stock);
	const liquidity = turnover !== null && turnover > 0 ? clamp$2(Math.log10(turnover / 1e6) / 2) : .3;
	const ratio = volumeRatio(stock);
	let volume;
	if (ratio === null) volume = .4;
	else {
		volume = clamp$2((ratio - .4) / 1.2);
		if (ratio > 3) volume *= Math.max(.4, 1 - (ratio - 3) / 5);
	}
	const resistanceValue = resistance(stock);
	let technicalUpside;
	if (resistanceValue === null) technicalUpside = .7;
	else {
		const upside = resistanceValue / stock.close - 1;
		technicalUpside = upside < .02 ? .45 : clamp$2(upside / .05);
	}
	const atr = atrPct(stock);
	let volatility;
	if (atr === null) volatility = .4;
	else {
		volatility = 1 - Math.min(Math.abs(atr - config.targetAtrPct) / Math.max(config.targetAtrPct, EPSILON), 1);
		if (atr > .05) volatility *= Math.max(.2, 1 - (atr - .05) / .05);
	}
	let breakout = 0;
	let near = resistanceValue === null;
	if (resistanceValue !== null) near = resistanceValue / stock.close - 1 <= config.breakoutDistance;
	const consolidated = week >= -.02 && week <= .08 && (atr === null || atr <= .04) && stock.sma20 !== null && stock.close > stock.sma20;
	breakout = (near ? .4 : 0) + (consolidated ? .3 : 0) + (ratio !== null && ratio >= .8 && ratio <= 2.5 ? .3 : 0);
	if (week > config.overextendedWeek || stock.rsi !== null && stock.rsi >= config.overextendedRsi || isDaySpike(stock, config)) breakout *= .25;
	return {
		momentum,
		trend,
		relativeStrength,
		liquidity,
		volume,
		technicalUpside,
		volatility,
		news: newsOpportunity(signal),
		breakout,
		consistency: consistencyScore(stock, config)
	};
}
function riskComponents(stock, signal, today, config) {
	const atr = atrPct(stock);
	const volatility = atr === null ? .5 : clamp$2((atr - .015) / .055);
	const overextensionValues = [clamp$2(((stock.weekReturn ?? 0) - .1) / .15)];
	if (stock.rsi !== null) overextensionValues.push(clamp$2((stock.rsi - 65) / 20));
	if (stock.sma20 !== null && stock.sma20 > 0) overextensionValues.push(clamp$2((stock.close / stock.sma20 - 1 - .08) / .15));
	if (stock.monthReturn !== null) overextensionValues.push(clamp$2((stock.monthReturn - .3) / .2));
	const overextension = Math.max(...overextensionValues);
	const turnover = averageTurnover(stock);
	let liquidity;
	if (turnover === null) liquidity = .6;
	else if (turnover < config.minAverageTurnover) liquidity = 1;
	else if (turnover < 1e7) liquidity = .7;
	else if (turnover < 3e7) liquidity = .4;
	else if (turnover < 1e8) liquidity = .15;
	else liquidity = 0;
	let event = 0;
	const earnings = daysUntil(stock.earningsDate, today);
	if (earnings !== null && earnings >= 0 && earnings <= 7) event = Math.max(event, {
		0: 1,
		1: .85,
		2: .55,
		3: .35
	}[earnings] ?? .15);
	const exDate = daysUntil(stock.exDividendDate, today);
	if (exDate !== null && exDate >= 0 && exDate <= 1) event = Math.max(event, exDate === 0 ? .5 : .3);
	const cap = stock.marketCap;
	let marketCap;
	if (cap === null) marketCap = .3;
	else if (cap < 3e8) marketCap = 1;
	else if (cap < 1e9) marketCap = .65;
	else if (cap < 3e9) marketCap = .35;
	else if (cap < 1e10) marketCap = .1;
	else marketCap = 0;
	const price = stock.close;
	let priceRisk;
	if (price < 10) priceRisk = 1;
	else if (price < 20) priceRisk = .65;
	else if (price < 50) priceRisk = .25;
	else if (price < 100) priceRisk = .1;
	else priceRisk = 0;
	return {
		volatility,
		overextension,
		spike: spikeRisk(stock, signal, config),
		liquidity,
		event,
		negativeNews: newsRisk(signal),
		marketCap,
		price: priceRisk
	};
}
function signedPoints(value) {
	return `${`${value >= 0 ? "+" : ""}${value.toFixed(1)}`.replace(".", ",")} %`;
}
function reasons(stock, config) {
	const values = [`Uke ${formatPct(stock.weekReturn)}`];
	if (stock.dayReturn !== null) values.push(`Dag ${formatPct(stock.dayReturn)}`);
	values.push(`Måned ${formatPct(stock.monthReturn)}`);
	if (isSmoothDay(stock, config)) values.push("Jevn uke");
	if (stock.sma20) values.push(`${signedPoints((stock.close / stock.sma20 - 1) * 100)} over SMA20`);
	if (stock.rsi !== null) values.push(`RSI ${stock.rsi.toFixed(0)}`);
	if (averageTurnover(stock) !== null) values.push(`${formatMarketCap(averageTurnover(stock))}/dag`);
	const atr = atrPct(stock);
	if (atr !== null) values.push(`ATR ${(atr * 100).toFixed(1).replace(".", ",")} %`);
	return values;
}
function warnings(stock, signal, today, status, config) {
	const values = [];
	const day = stock.dayReturn;
	const share = dayShare(stock);
	if (day !== null && day >= config.strongSpikeDayReturn) values.push(`Stort dagshopp ${formatPct(day)} – svært høy jagrisiko`);
	else if (isDaySpike(stock, config)) {
		const shareText = share !== null && share !== 0 ? ` (${(share * 100).toFixed(0)} % av uken)` : "";
		if (isRelevantSignal(signal) && signal.sentiment === "positive" && signal.eventType !== "capital_raise") values.push(`Stort dagshopp ${formatPct(day)}${shareText} – mulig nyhetsdrevet, vent på pullback`);
		else values.push(`Stort dagshopp ${formatPct(day)}${shareText} – vent på pullback`);
	} else if (day !== null && day >= config.spikeDayReturn) values.push(`Stor enkeltdag ${formatPct(day)} – sjekk nyhet og volum`);
	const earnings = daysUntil(stock.earningsDate, today);
	if (earnings === 0) values.push("Resultat i dag");
	else if (earnings === 1) values.push("Resultat i morgen");
	else if (earnings !== null && earnings >= 2 && earnings <= 7) values.push(`Resultat om ${earnings} dager`);
	const exDate = daysUntil(stock.exDividendDate, today);
	if (exDate === 0) values.push("Ex-dato i dag");
	else if (exDate === 1) values.push("Ex-dato i morgen");
	if (stock.rsi !== null && stock.rsi >= 75) values.push("RSI over 75 – overopphetet");
	if ((stock.weekReturn ?? 0) > .15) values.push("Sterk uke – fare for pause");
	if (status === "overstrukket") values.push("Nær høy, men allerede strukket");
	if (stock.close < 10) values.push("Lav aksjekurs – større prosentvise bevegelser");
	const turnover = averageTurnover(stock);
	if (turnover === null) values.push("Likviditet ukjent");
	else if (turnover < 1e7) values.push("Lav likviditet");
	if (stock.marketCap !== null && stock.marketCap < 1e9) values.push("Liten markedsverdi");
	if (stock.monthReturn === null) values.push("Månedstrend mangler");
	if (signal.eventType === "capital_raise") values.push("Emisjon/kapitalinnhenting – utvanningsrisiko");
	else if (signal.sentiment === "negative" && isRelevantSignal(signal)) values.push("Negativ nyhet – sjekk kilden");
	else if (signal.sentiment === "mixed" && isRelevantSignal(signal)) values.push("Blandet nyhetsbilde");
	return values;
}
function buildCandidate(stock, context, signal, today, config) {
	const opportunityComponentsValue = opportunityComponents(stock, context, signal, config);
	const riskComponentsValue = riskComponents(stock, signal, today, config);
	const opportunity = 100 * weighted(opportunityComponentsValue, weightsOf(config.weights));
	const risk = 100 * weighted(riskComponentsValue, weightsOf(config.riskWeights));
	const score = clamp$2(opportunity * (1 - config.riskPenalty * risk / 100), 0, 100);
	const status = breakoutStatus(stock, config, signal);
	const resistanceValue = resistance(stock);
	const supportValue = support(stock);
	const upside = resistanceValue !== null ? resistanceValue / stock.close - 1 : null;
	return {
		stock,
		score,
		reasons: reasons(stock, config),
		warnings: warnings(stock, signal, today, status, config),
		opportunityScore: opportunity,
		riskScore: risk,
		categories: categories(stock, config, signal, status),
		newsSignal: signal,
		breakoutStatus: status,
		technicalUpside: upside,
		resistance: resistanceValue,
		support: supportValue,
		volumeRatio: volumeRatio(stock)
	};
}
function rankCandidates(stocks, limit = 5, today, news = null, config) {
	const items = Array.from(stocks);
	const context = buildContext(items);
	const candidates = items.filter((stock) => isCandidate(stock, config)).map((stock) => buildCandidate(stock, context, news !== null ? signalFor(news, stock) : emptyNewsSignal(), today, config));
	candidates.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		if (a.riskScore !== b.riskScore) return a.riskScore - b.riskScore;
		if (b.opportunityScore !== a.opportunityScore) return b.opportunityScore - a.opportunityScore;
		if ((b.stock.weekReturn ?? 0) !== (a.stock.weekReturn ?? 0)) return (b.stock.weekReturn ?? 0) - (a.stock.weekReturn ?? 0);
		return a.stock.ticker.localeCompare(b.stock.ticker);
	});
	return candidates.slice(0, Math.max(0, limit));
}
var SWING_ATR_STOP_MULTIPLIER = 1.2;
var SWING_MIN_STOP_PCT = .04;
var SWING_MAX_STOP_PCT = .06;
var SWING_TARGET_STOP_MULTIPLE = 1.8;
var SWING_MIN_TARGET_PCT = .08;
var SWING_MAX_TARGET_PCT = .1;
function clamp$1(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, value));
}
/**
* Swing plans use a stop of roughly 1.2x ATR, bounded to 4-6 %, and a target
* of 1.8x the stop, bounded to 8-10 %. The bounds keep risk readable for a
* small account and avoid very tight stops on volatile shares.
*/
function tradeLevels(config, atrPctValue = null) {
	if (config.mode === "day") return {
		mode: "day",
		targetPct: config.targetPct,
		stopPct: config.stopLossPct,
		maxHoldingDays: 1
	};
	const fallbackStop = clamp$1(config.stopLossPct, SWING_MIN_STOP_PCT, SWING_MAX_STOP_PCT);
	const stopPct = clamp$1(atrPctValue !== null && Number.isFinite(atrPctValue) && atrPctValue > 0 ? atrPctValue * SWING_ATR_STOP_MULTIPLIER : fallbackStop, SWING_MIN_STOP_PCT, SWING_MAX_STOP_PCT);
	return {
		mode: "swing",
		targetPct: clamp$1(stopPct * SWING_TARGET_STOP_MULTIPLE, SWING_MIN_TARGET_PCT, SWING_MAX_TARGET_PCT),
		stopPct,
		maxHoldingDays: 5
	};
}
/** A Friday reminder, not an automatic sell rule. */
function weekendFlag(now = /* @__PURE__ */ new Date()) {
	if (osloParts(now).weekday !== 5) return null;
	return "Helgeflagg: Fredag i dag. Du kan holde posisjonen over helgen, men vær oppmerksom på gaprisiko og at nye kjøp sent på fredag kan få en dårligere inngang. La stopen og planen styre, ikke klokken.";
}
// src/core/trade.ts
function buildTradePlan(price, config, scenarioPcts, atrPctValue = null) {
	if (price <= 0) return emptyPlan(config, price, atrPctValue);
	const levels = tradeLevels(config, atrPctValue);
	const buyPrice = price * (1 + Math.max(0, config.slippagePct));
	const budget = Math.max(0, config.capital - config.buyFee);
	const shares = Math.floor(budget / buyPrice);
	if (shares <= 0) return emptyPlan(config, price, atrPctValue);
	const invested = shares * buyPrice;
	const totalCost = invested + config.buyFee;
	const cashLeft = config.capital - totalCost;
	const targetPrice = buyPrice * (1 + levels.targetPct);
	const stopPrice = buyPrice * (1 - levels.stopPct);
	const targetNet = netTradeResult(shares, buyPrice, targetPrice, config);
	const stopNet = netTradeResult(shares, buyPrice, stopPrice, config);
	const rewardRisk = stopNet < 0 && targetNet > 0 ? targetNet / Math.abs(stopNet) : null;
	const scenarios = (scenarioPcts !== void 0 ? Array.from(scenarioPcts) : config.scenarioPcts).map((change) => scenario(shares, buyPrice, config, change));
	return {
		capital: config.capital,
		buyFee: config.buyFee,
		sellFee: config.sellFee,
		entryPrice: buyPrice,
		shares,
		invested,
		cashLeft,
		totalCost,
		targetPrice,
		targetNet,
		targetReturnPct: totalCost !== 0 ? targetNet / totalCost * 100 : 0,
		targetPct: levels.targetPct,
		stopPrice,
		stopNet,
		stopReturnPct: totalCost !== 0 ? stopNet / totalCost * 100 : 0,
		stopPct: levels.stopPct,
		mode: levels.mode,
		maxHoldingDays: levels.maxHoldingDays,
		rewardRisk,
		scenarios,
		feasible: true
	};
}
/**
* Net result after both fees and any configured slippage. Exported so custom
* trade plans (for example Etrade levels) use exactly the same cost model as
* the swing and day plans.
*/
function netTradeResult(shares, buyPrice, sellPrice, config) {
	return shares * (Math.max(0, sellPrice) * (1 - Math.max(0, config.slippagePct))) - config.sellFee - shares * buyPrice - config.buyFee;
}
function scenario(shares, buyPrice, config, change) {
	const exitPrice = buyPrice * (1 + change);
	const grossProfit = shares * (exitPrice - buyPrice);
	const netProfit = netTradeResult(shares, buyPrice, exitPrice, config);
	const totalCost = shares * buyPrice + config.buyFee;
	return {
		changePct: change,
		exitPrice,
		grossProfit,
		netProfit,
		netReturnPct: totalCost !== 0 ? netProfit / totalCost * 100 : 0
	};
}
function emptyPlan(config, price, atrPctValue) {
	const levels = tradeLevels(config, atrPctValue);
	return {
		capital: config.capital,
		buyFee: config.buyFee,
		sellFee: config.sellFee,
		entryPrice: price,
		shares: 0,
		invested: 0,
		cashLeft: config.capital,
		totalCost: 0,
		targetPrice: 0,
		targetNet: 0,
		targetReturnPct: 0,
		targetPct: levels.targetPct,
		stopPrice: 0,
		stopNet: 0,
		stopReturnPct: 0,
		stopPct: levels.stopPct,
		mode: levels.mode,
		maxHoldingDays: levels.maxHoldingDays,
		rewardRisk: null,
		scenarios: [],
		feasible: false
	};
}
// src/core/volume.ts
var SESSION_OPEN_MINUTES = 540;
var SESSION_CLOSE_MINUTES = 990;
/**
* Approximate share of a normal Oslo Børs day that has traded by a given time.
*
* The scanner reports today's cumulative volume, while the comparison value is
* a full-day 10-day average. A simple linear curve would make every stock look
* quiet in the morning and busy at the close. Oslo is U-shaped: the opening and
* closing hours carry more volume than the middle of the day. The points below
* are deliberately rough; they only need to keep the volume gate from rejecting
* every liquid stock before lunch.
*/
var CUMULATIVE_VOLUME_SHARE = [
	[SESSION_OPEN_MINUTES, 0],
	[570, .13],
	[600, .21],
	[660, .33],
	[720, .43],
	[780, .52],
	[840, .62],
	[900, .73],
	[960, .88],
	[SESSION_CLOSE_MINUTES, 1]
];
function interpolate(minutes) {
	for (let index = 1; index < CUMULATIVE_VOLUME_SHARE.length; index += 1) {
		const [endMinute, endShare] = CUMULATIVE_VOLUME_SHARE[index];
		if (minutes <= endMinute) {
			const [startMinute, startShare] = CUMULATIVE_VOLUME_SHARE[index - 1];
			const span = endMinute - startMinute;
			if (span <= 0) return endShare;
			const progress = (minutes - startMinute) / span;
			return startShare + (endShare - startShare) * progress;
		}
	}
	return 1;
}
/**
* How much of a normal trading day's volume has printed by `now` (0–1).
* Outside the session the day is complete, so the share is 1. Before the
* opening auction it is 0 because there is no meaningful pace yet.
*/
function expectedVolumeShare(now = /* @__PURE__ */ new Date()) {
	const session = marketSession(now);
	if (session === "closed") return 1;
	if (session === "pre") return 0;
	const parts = osloParts(now);
	return interpolate(Math.max(SESSION_OPEN_MINUTES, Math.min(SESSION_CLOSE_MINUTES, parts.hour * 60 + parts.minute)));
}
/**
* Converts a raw cumulative volume ratio (today's volume divided by the
* 10-day average daily volume) into a pace ratio relative to the time of day.
*
* A pace of 1 means the stock has traded exactly on its normal pace, 0.7 means
* it is 30 % behind, and 2 means twice the normal pace. This is the value that
* should be compared with fixed thresholds; comparing the raw ratio early in
* the day rejects liquid stocks simply because the session has just started.
*
* Returns null when there is no meaningful volume signal. Outside the session
* the raw ratio is returned unchanged.
*/
function timeWeightedVolumeRatio(rawRatio, now = /* @__PURE__ */ new Date()) {
	if (rawRatio === null || !Number.isFinite(rawRatio) || rawRatio < 0) return null;
	const share = expectedVolumeShare(now);
	if (share <= 0) return null;
	return rawRatio / share;
}
var ETRADE_MIN_STOP_PCT = .03;
var ETRADE_MAX_STOP_PCT = .05;
var ETRADE_TARGET_MULTIPLES = [
	2,
	3.5,
	5
];
var ETRADE_SETUP_LABELS = {
	breakout: "Breakout",
	pullback: "Pullback",
	momentum: "Momentum",
	news: "Nyhetsdrevet"
};
/** Partial exits at T1/T2/T3 and the remaining runner, using whole shares. */
function etradeExitQuantities(shares) {
	let remaining = Math.max(0, Math.floor(shares));
	const exits = [];
	for (let stage = 0; stage < 3; stage += 1) {
		const quantity = remaining === 0 ? 0 : remaining === 1 ? 1 : Math.max(1, Math.floor(remaining / 2));
		exits.push(quantity);
		remaining -= quantity;
	}
	return [
		exits[0],
		exits[1],
		exits[2],
		remaining
	];
}
/** Derive stop/target prices from the actual filled entry, not a stale trigger. */
function etradeLevelsForEntry(entry, stopPct) {
	const riskPerShare = entry * stopPct;
	return {
		stopPrice: entry - riskPerShare,
		targets: ETRADE_TARGET_MULTIPLES.map((multiple, index) => ({
			label: `T${index + 1}`,
			price: entry + riskPerShare * multiple,
			pct: riskPerShare * multiple / entry,
			net: 0,
			netPct: 0
		}))
	};
}
function clamp(value, minimum = 0, maximum = 1) {
	return Math.min(maximum, Math.max(minimum, value));
}
function positive(value) {
	return value !== null && value !== void 0 && Number.isFinite(value) && value > 0;
}
/**
* Invalidation for a breakout must sit below the current price. The level just
* below the breakout high is only a failure level after the breakout has
* happened; before that the price is naturally below it, and the simulator
* would refuse to place the pending order. Fall back to the nearest support
* when the breakout level is above the last price.
*/
function breakoutInvalidation(level, support, close) {
	const levelInvalidation = level * .995;
	if (levelInvalidation < close) return levelInvalidation;
	if (positive(support)) {
		const supportInvalidation = support * .995;
		if (supportInvalidation < close) return supportInvalidation;
	}
	return close * .997;
}
function chooseSetup(candidate) {
	const stock = candidate.stock;
	const close = stock.close;
	const dayHigh = positive(stock.high) ? Math.max(stock.high, close) : close;
	const week = stock.weekReturn ?? 0;
	const rsi = stock.rsi ?? 50;
	const sma5 = positive(stock.sma5) ? stock.sma5 : null;
	const sma20 = positive(stock.sma20) ? stock.sma20 : null;
	const overextended = rsi >= 72 || week >= .18;
	const pullbackLevel = sma20 !== null && close >= sma20 && close / sma20 - 1 <= .02 ? Math.max(sma20, positive(stock.vwap) ? stock.vwap : sma20) : null;
	const positiveNews = candidate.newsSignal.count > 0 && candidate.newsSignal.sentiment === "positive" && candidate.newsSignal.eventType !== "capital_raise";
	const keyHigh = [candidate.resistance, stock.previousDayHigh].filter((level) => positive(level) && Math.abs(level / close - 1) <= .05).sort((left, right) => Math.abs(left / close - 1) - Math.abs(right / close - 1))[0] ?? null;
	if (pullbackLevel !== null && !overextended && rsi < 65) return {
		setup: "pullback",
		trigger: pullbackLevel * 1.003,
		invalidation: sma20 * .995
	};
	if (positiveNews && !overextended) return {
		setup: "news",
		trigger: dayHigh * 1.003,
		invalidation: positive(stock.low) ? stock.low * .995 : null
	};
	if (overextended) return {
		setup: "momentum",
		trigger: close * 1.003,
		invalidation: sma5 !== null && sma5 < close ? sma5 * .995 : null
	};
	if (keyHigh !== null) return {
		setup: "breakout",
		trigger: keyHigh * 1.003,
		invalidation: breakoutInvalidation(keyHigh, candidate.support, close)
	};
	return {
		setup: "breakout",
		trigger: dayHigh * 1.003,
		invalidation: breakoutInvalidation(dayHigh, candidate.support, close)
	};
}
function scoreIdea(candidate, setup, trigger, volumePace) {
	const stock = candidate.stock;
	const proximity = stock.close > 0 ? clamp(1 - Math.abs(trigger / stock.close - 1) / .06) : 0;
	const volume = volumePace === null ? .35 : clamp((volumePace - .5) / 1.5);
	const setupBonus = {
		breakout: 8,
		news: 6,
		pullback: 5,
		momentum: 2
	};
	const overextended = (stock.rsi ?? 50) >= 72 || (stock.weekReturn ?? 0) >= .18;
	const newsBonus = candidate.newsSignal.count > 0 && candidate.newsSignal.sentiment === "positive" ? 4 : 0;
	return clamp(candidate.score * .6 + candidate.opportunityScore * .4 + setupBonus[setup] + 10 * volume + 5 * proximity + newsBonus - (overextended ? 10 : 0), 0, 100);
}
function ideaWarnings(candidate, atrKnown, today, volumePace) {
	const stock = candidate.stock;
	const values = [];
	if (!atrKnown) values.push("ATR mangler – stoppen bruker 4 % fallback. Kontroller nivået manuelt.");
	if ((stock.rsi ?? 0) >= 75) values.push("RSI over 75 – vent på en kontrollert pause før du kjøper.");
	if ((stock.dayReturn ?? 0) >= .05) values.push("Stor dagbevegelse – ikke jag prisen. Vent på trigger og volum.");
	if (volumePace !== null && volumePace < 1) values.push("Volumet er under forventet så langt i dag – krever bekreftelse før inngang.");
	const earnings = daysUntil(stock.earningsDate, today);
	if (earnings !== null && earnings >= 0 && earnings <= 5) values.push(`Resultat om ${earnings === 0 ? "i dag" : `${earnings} dager`} – høyere gaprisiko.`);
	if (stock.close < 10) values.push("Lav aksjekurs – større prosentvise utslag og spreadrisiko.");
	return values;
}
function ideaBlockReasons(candidate, setup, targets, rewardRisk, today, volumePace) {
	const stock = candidate.stock;
	const values = [];
	if (targets.length === 0 || targets[0].net <= 0) values.push("første mål dekker ikke kurtasjen");
	if (rewardRisk === null || rewardRisk < 1) values.push("gevinst/tap under 1:1 etter kurtasje");
	if (volumePace !== null && volumePace < .7) values.push("volumet er under forventet så langt i dag");
	if (stock.rsi !== null && stock.rsi >= 75) values.push("RSI over 75 – overopphetet");
	if ((stock.weekReturn ?? 0) >= .2) values.push("uken er svært strukket");
	if ((stock.dayReturn ?? 0) >= .08) values.push("stort dagshopp – jag ikke");
	if (setup === "breakout" && positive(stock.previousDayHigh) && stock.close > stock.previousDayHigh * 1.05) values.push("kursen er over 5 % over gårsdagens topp – vent på pullback");
	const earnings = daysUntil(stock.earningsDate, today);
	if (earnings !== null && earnings >= 0 && earnings <= 2) values.push("resultat innen 2 dager");
	if (candidate.newsSignal.eventType === "capital_raise") values.push("emisjon/kapitalinnhenting");
	if (candidate.newsSignal.count > 0 && candidate.newsSignal.sentiment === "negative") values.push("negativt nyhetsbilde");
	return values;
}
function buildIdea(candidate, settings, today, now) {
	const stock = candidate.stock;
	if (!Number.isFinite(stock.close) || stock.close <= 0) return null;
	const volumePace = timeWeightedVolumeRatio(candidate.volumeRatio, now);
	const config = settings.trade;
	const setup = chooseSetup(candidate);
	const entry = Math.max(setup.trigger, stock.close) * (1 + Math.max(0, config.slippagePct));
	const budget = Math.max(0, config.capital - config.buyFee);
	const shares = Math.floor(budget / entry);
	if (shares <= 0) return null;
	const atr = atrPct(stock);
	const stopPct = clamp((atr ?? .04) * 1, ETRADE_MIN_STOP_PCT, ETRADE_MAX_STOP_PCT);
	const levels = etradeLevelsForEntry(entry, stopPct);
	const invested = shares * entry;
	const totalCost = invested + config.buyFee;
	const cashLeft = config.capital - totalCost;
	const exitQuantities = etradeExitQuantities(shares);
	let realizedThroughTarget = 0;
	const targets = levels.targets.map((target, index) => {
		const quantity = exitQuantities[index] ?? 0;
		if (quantity > 0) realizedThroughTarget += quantity * (target.price - entry) - config.buyFee * quantity / shares - config.sellFee;
		return {
			...target,
			net: realizedThroughTarget,
			netPct: totalCost > 0 ? realizedThroughTarget / totalCost : 0
		};
	});
	const stopNet = netTradeResult(shares, entry, levels.stopPrice, config);
	const fullExitAtT1Net = targets[0] ? netTradeResult(shares, entry, targets[0].price, config) : null;
	const rewardRisk = stopNet < 0 && fullExitAtT1Net !== null && fullExitAtT1Net > 0 ? fullExitAtT1Net / Math.abs(stopNet) : null;
	const blockReasons = ideaBlockReasons(candidate, setup.setup, targets, rewardRisk, today, volumePace);
	const checks = [
		{
			label: "Volum over forventet",
			ok: volumePace !== null && volumePace >= .8
		},
		{
			label: "RSI under 75",
			ok: (stock.rsi ?? 0) < 75
		},
		{
			label: "Ikke strukket uke",
			ok: (stock.weekReturn ?? 0) < .2
		},
		{
			label: "Ingen negativ nyhet",
			ok: candidate.newsSignal.eventType !== "capital_raise" && !(candidate.newsSignal.count > 0 && candidate.newsSignal.sentiment === "negative")
		},
		{
			label: "T1 dekker kurtasje",
			ok: targets[0] !== void 0 && targets[0].net > 0
		},
		{
			label: "Minst 1:1 etter kurtasje",
			ok: rewardRisk !== null && rewardRisk >= 1
		}
	];
	return {
		candidate,
		setup: setup.setup,
		setupLabel: ETRADE_SETUP_LABELS[setup.setup],
		trigger: setup.trigger,
		invalidation: setup.invalidation,
		stopPrice: levels.stopPrice,
		stopPct,
		stopNet,
		shares,
		entry,
		invested,
		totalCost,
		cashLeft,
		targets,
		rewardRisk,
		horizonDays: 3,
		score: scoreIdea(candidate, setup.setup, setup.trigger, volumePace),
		volumePace,
		checks,
		blockReasons,
		warnings: ideaWarnings(candidate, atr !== null, today, volumePace)
	};
}
function buildEtradeReport(stocks, universe, news, settings, today, now = /* @__PURE__ */ new Date()) {
	const all = rankCandidates(stocks, 60, today, news, settings.scoring).map((candidate) => buildIdea(candidate, settings, today, now)).filter((idea) => idea !== null).sort((a, b) => b.score - a.score);
	const ideas = all.filter((idea) => idea.blockReasons.length === 0).slice(0, 6);
	const watchlist = all.filter((idea) => idea.blockReasons.length > 0).slice(0, 6);
	let noIdeaReason = null;
	if (ideas.length === 0) {
		if (all.length === 0) noIdeaReason = "Ingen aksjer passerte momentum- og likviditetsfiltrene akkurat nå. Vent på et tydeligere oppsett i stedet for å tvinge frem en handel.";
		else {
			const best = all[0];
			noIdeaReason = `Ingen ideer passer alle kriteriene nå. Beste kandidat er ${best.candidate.stock.ticker}, men ${best.blockReasons.join("; ")}.`;
		}
	}
	const warnings = [];
	if (universe.warning) warnings.push(universe.warning);
	if (universe.growthWarning) warnings.push(universe.growthWarning);
	if (news !== null && news.warning) warnings.push(news.warning);
	if (ideas.length > 0) {
		const helg = weekendFlag(now);
		if (helg !== null) warnings.push(helg);
	}
	const marketOpen = marketSession(now) === "open";
	const dataBasis = `Etrade-ideer fra siste kurs (${formatDateTime(universe.fetchedAt)}). Horisont 1–3 handledager, med runner etter T3 i opptil 10 dager. Bruddtrigger bruker nærliggende historisk motstand, inkludert forrige dags topp; hvis nivået allerede er brutt vises det som bekreftet. Kurs og handelsplan bruker siste handlede kurs.`;
	return {
		generatedAt: now,
		universeFetchedAt: universe.fetchedAt,
		universeSource: universe.source,
		settings,
		ideas,
		watchlist,
		noIdeaReason,
		dataBasis,
		marketOpen,
		warnings
	};
}
// src/core/journal.ts
/**
* Trading days since the position was opened, including the buy day.
* Weekends and Oslo Børs holidays are skipped.
*/
function tradingDaysHeld(openedAt, now = /* @__PURE__ */ new Date()) {
	if (openedAt === null) return null;
	const opened = new Date(openedAt);
	if (Number.isNaN(opened.getTime())) return null;
	const start = osloDateString(opened);
	const end = osloDateString(now);
	if (end < start) return 0;
	let date = start;
	let days = 0;
	for (let guard = 0; date <= end && guard < 1e3; guard += 1) {
		if (isOsloMarketOpenDay(date)) days += 1;
		date = addDaysToDateString(date, 1);
	}
	return days;
}
// src/core/report.ts
function blockReasons(candidate, trade, settings, today) {
	const values = [];
	const report = settings.report;
	if (candidate.score < report.minTotalScore) values.push(`samlet score ${candidate.score.toFixed(0)} < ${report.minTotalScore.toFixed(0)}`);
	if (candidate.opportunityScore < report.minOpportunity) values.push(`mulighetsscore ${candidate.opportunityScore.toFixed(0)} < ${report.minOpportunity.toFixed(0)}`);
	if (candidate.riskScore > report.maxRisk) values.push(`risikoscore ${candidate.riskScore.toFixed(0)} > ${report.maxRisk.toFixed(0)}`);
	if (!trade.feasible) values.push("ikke nok kapital til én hel aksje etter kurtasje");
	else if (trade.targetNet <= 0) values.push("gevinstmålet dekker ikke kurtasjen etter kurtasje");
	if (trade.rewardRisk !== null && trade.rewardRisk < settings.trade.minRewardRisk) values.push("gevinst/tap-forholdet er for lavt");
	const turnover = candidate.stock.close * (candidate.stock.averageVolume10d ?? 0);
	if (candidate.stock.averageVolume10d === null || turnover < report.minTurnover) values.push("likviditeten er under rapportens minstekrav");
	if (candidate.categories.length === 0) values.push("ingen tydelig kategori (momentum, breakout eller nyheter)");
	if (settings.trade.mode === "swing" && (candidate.stock.sma50 === null || candidate.stock.close <= candidate.stock.sma50)) values.push("ikke over SMA50 (svak langsiktig trend)");
	if (report.blockNegativeNews && isNegativeSignal(candidate.newsSignal)) values.push("negativt nyhetssignal");
	const earningsWindow = settings.trade.mode === "swing" ? Math.max(report.blockEarningsWithinDays, 3) : report.blockEarningsWithinDays;
	const earnings = daysUntil(candidate.stock.earningsDate, today);
	if (earnings !== null && earnings >= 0 && earnings <= earningsWindow) {
		if (earningsWindow <= 1) values.push("resultat i dag eller i morgen");
		else values.push(`resultat innen ${earningsWindow} dager`);
	}
	const exDate = daysUntil(candidate.stock.exDividendDate, today);
	if (exDate !== null && exDate >= 0 && exDate <= report.blockExDateWithinDays) {
		if (report.blockExDateWithinDays === 0) values.push("ex-dato i dag");
		else values.push(`ex-dato innen ${report.blockExDateWithinDays} dager`);
	}
	return values;
}
function buildMarketReport(stocks, criteria, universe, news = null, settings, today, now = /* @__PURE__ */ new Date()) {
	const stockList = Array.from(stocks);
	const planned = rankCandidates(stockList, stockList.length, today, news, settings.scoring).map((candidate) => {
		const trade = buildTradePlan(candidate.stock.close, settings.trade, void 0, atrPct(candidate.stock));
		const reasons = blockReasons(candidate, trade, settings, today);
		return {
			candidate,
			trade,
			recommendable: reasons.length === 0,
			blockReasons: reasons
		};
	});
	const recommendable = planned.filter((item) => item.recommendable);
	const blockedAll = planned.filter((item) => !item.recommendable);
	const main = recommendable.length > 0 ? recommendable[0] : null;
	const alternatives = recommendable.filter((item) => item !== main).slice(0, settings.report.maxAlternatives);
	const blocked = blockedAll.slice(0, settings.report.maxAlternatives);
	const selected = [
		...main !== null ? [main] : [],
		...alternatives,
		...blocked
	];
	let noTradeReason = null;
	if (main === null) {
		if (planned.length === 0) noTradeReason = "Ingen anbefalte kandidater i dag – vurder å stå over. Ingen aksjer passerte de tekniske kandidatfiltrene.";
		else {
			const best = planned[0];
			const reason = best.blockReasons.length > 0 ? best.blockReasons.join("; ") : "kravene er ikke oppfylt";
			noTradeReason = `Ingen anbefalte kandidater i dag – vurder å stå over. Beste kandidat er ${best.candidate.stock.ticker}, men ${reason}.`;
		}
	}
	const warnings = [];
	if (universe.warning) warnings.push(universe.warning);
	if (universe.growthWarning) warnings.push(universe.growthWarning);
	if (news !== null && news.warning) warnings.push(news.warning);
	if (main !== null && main.trade.rewardRisk !== null && main.trade.rewardRisk < 1) warnings.push(`Gevinst/tap-forholdet er under 1:1 etter kurtasje. Med ${formatMoney(main.trade.capital)} kapital og ${formatMoney(main.trade.buyFee + main.trade.sellFee)} i kurtasje spiser kostnadene en stor del av et ${formatPct(main.trade.targetPct ?? settings.trade.targetPct, 1, false)} mål; vurder et høyere mål eller la handelen være.`);
	const helgeflagg = main !== null ? weekendFlag(now) : null;
	if (helgeflagg !== null) warnings.push(helgeflagg);
	const marketOpen = marketSession(now) === "open";
	const dataBasis = `Siste kurs fra TradingView (${formatDateTime(universe.fetchedAt)})` + (news !== null ? ` og NewsWeb til ${formatDateTime(news.fetchedAt)}` : " uten nyhetshenting") + ". Score bruker daglige data; kurs og handelsplan bruker siste handlede kurs." + (settings.trade.mode === "swing" ? " Swingplanen har 2–5 handledagers horisont." : "");
	return {
		generatedAt: now,
		universeFetchedAt: universe.fetchedAt,
		universeSource: universe.source,
		criteria,
		settings,
		ranked: selected,
		main,
		alternatives,
		blocked,
		noTradeReason,
		newsSince: news !== null ? news.since : null,
		newsSource: news !== null ? news.source : null,
		dataBasis,
		marketOpen,
		warnings
	};
}
// src/core/screen.ts
var DEFAULT_CRITERIA = {
	minWeekReturn: 0,
	athMargin: .01,
	requireAboveSma5: true,
	requireAboveSma20: false,
	minMarketCap: 0,
	minTurnover: 0,
	includeTypes: ["stock", "dr"],
	allowUnknownAth: false,
	includeAtHigh: true,
	excludeGrowth: true
};
function nearAth(stock, criteria) {
	const ref = stockReferenceAth(stock);
	return ref !== null && stock.close >= ref * (1 - criteria.athMargin);
}
function stockReferenceAth(stock) {
	const values = [stock.ath, stock.high52w].filter((value) => value !== null && value > 0);
	return values.length > 0 ? Math.max(...values) : null;
}
function isAtHigh(stock, criteria) {
	if (!stockAthReliable(stock)) return false;
	const ref = stockReferenceAth(stock);
	if (ref === null) return false;
	return stock.close >= ref * (1 - criteria.athMargin);
}
function stockAthReliable(stock) {
	if (stock.ath === null || stock.ath <= 0) return false;
	if (stock.high52w !== null && stock.high52w > 0) {
		if (stock.ath > stock.high52w * 50) return false;
	}
	return true;
}
function evaluate(stock, criteria) {
	if (criteria.excludeGrowth && stock.market === "euronext_growth") return {
		passes: false,
		reason: "euronext growth"
	};
	if (!criteria.includeTypes.includes(stock.instrumentType)) return {
		passes: false,
		reason: "ikke aksje"
	};
	if (stock.weekReturn === null) return {
		passes: false,
		reason: "mangler ukedata"
	};
	if (stock.weekReturn <= criteria.minWeekReturn) return {
		passes: false,
		reason: "svak uke"
	};
	if (criteria.requireAboveSma5) {
		if (stock.sma5 === null || stock.close <= stock.sma5) return {
			passes: false,
			reason: "under SMA5"
		};
	}
	if (criteria.requireAboveSma20) {
		if (stock.sma20 === null || stock.close <= stock.sma20) return {
			passes: false,
			reason: "under SMA20"
		};
	}
	if (criteria.minMarketCap > 0) {
		if (stock.marketCap === null || stock.marketCap < criteria.minMarketCap) return {
			passes: false,
			reason: "for lav markedsverdi"
		};
	}
	if (criteria.minTurnover > 0) {
		const value = turnover(stock);
		if (value === null || value < criteria.minTurnover) return {
			passes: false,
			reason: "for lavt omsetningsvolum"
		};
	}
	if (stockReferenceAth(stock) === null) {
		if (criteria.allowUnknownAth) return {
			passes: true,
			reason: ""
		};
		return {
			passes: false,
			reason: "ukjent ATH"
		};
	}
	const near = nearAth(stock, criteria);
	if (!stockAthReliable(stock)) {
		if (criteria.allowUnknownAth) return {
			passes: true,
			reason: ""
		};
		if (near) return {
			passes: false,
			reason: stock.ath === null || stock.ath <= 0 ? "ukjent ATH" : "ATH usikker"
		};
		const high52w = stock.high52w;
		if (high52w !== null && high52w > 0 && stock.close < high52w * (1 - criteria.athMargin)) return {
			passes: true,
			reason: ""
		};
		return {
			passes: false,
			reason: "ATH usikker"
		};
	}
	if (near) {
		if (criteria.includeAtHigh) return {
			passes: true,
			reason: ""
		};
		return {
			passes: false,
			reason: "på/ved ATH"
		};
	}
	return {
		passes: true,
		reason: ""
	};
}
function screen(stocks, criteria) {
	const matches = [];
	const excluded = {};
	let atHighCount = 0;
	let universeSize = 0;
	for (const stock of stocks) {
		universeSize += 1;
		const result = evaluate(stock, criteria);
		if (result.passes) {
			matches.push(stock);
			if (isAtHigh(stock, criteria)) atHighCount += 1;
		} else excluded[result.reason] = (excluded[result.reason] ?? 0) + 1;
	}
	return {
		matches,
		universeSize,
		excluded,
		atHighCount
	};
}
// src/core/simulator.ts
/**
* Forward paper trading for the two report modes.
*
* The simulator only decides long trades and never talks to a broker. Each
* mode has its own 5 000 kr portfolio and can hold at most one stock at a time.
* The Edge Function calls this module every ten minutes while Oslo Børs is open,
* so the same core rules used by the app are applied to the paper portfolio.
*/
var SIM_STARTING_CASH = 5e3;
function money(value) {
	return Math.round(value * 100) / 100;
}
function emptyPortfolioState(cash = SIM_STARTING_CASH) {
	return {
		cash: money(cash),
		position: null,
		pending: null
	};
}
function stockFor(snapshot, ticker) {
	return snapshot.universe.stocks.find((stock) => stock.ticker === ticker) ?? null;
}
function sellQuantity(position, requested) {
	return Math.max(0, Math.min(position.shares, Math.floor(requested)));
}
function executeBuy(context, input) {
	const { state } = context;
	if (state.position !== null || input.shares <= 0 || input.price <= 0) return false;
	const affordable = Math.floor((state.cash - input.fee) / input.price);
	const shares = Math.min(input.shares, affordable);
	if (shares <= 0) return false;
	const totalCost = money(shares * input.price + input.fee);
	if (totalCost > state.cash + .005) return false;
	state.cash = money(state.cash - totalCost);
	state.position = {
		ticker: input.ticker,
		shares,
		originalShares: shares,
		entryPrice: input.price,
		entryFee: input.fee,
		entryAt: context.now.toISOString(),
		stopPrice: input.stopPrice,
		stopPct: input.stopPct,
		targetPrice: input.targetPrice,
		targets: input.targets,
		stage: input.stage ?? 0,
		highestPrice: input.price,
		lastPrice: input.price,
		maxHoldingDays: input.maxHoldingDays,
		reason: input.reason
	};
	state.pending = null;
	context.trades.push({
		ticker: input.ticker,
		side: "buy",
		quantity: shares,
		price: input.price,
		fee: input.fee,
		executedAt: context.now.toISOString(),
		reason: input.reason,
		realizedPnl: null
	});
	return true;
}
function executeSell(context, input) {
	const { state } = context;
	const position = state.position;
	if (position === null) return;
	const quantity = sellQuantity(position, input.quantity);
	if (quantity <= 0) return;
	const proceeds = money(quantity * input.price - input.fee);
	context.sold = true;
	const allocatedBuyFee = position.originalShares > 0 ? position.entryFee * quantity / position.originalShares : 0;
	const realized = money(quantity * (input.price - position.entryPrice) - input.fee - allocatedBuyFee);
	state.cash = money(state.cash + proceeds);
	context.trades.push({
		ticker: position.ticker,
		side: "sell",
		quantity,
		price: input.price,
		fee: input.fee,
		executedAt: context.now.toISOString(),
		reason: input.reason,
		realizedPnl: realized
	});
	if (quantity >= position.shares) {
		state.position = null;
		return;
	}
	position.shares -= quantity;
	position.lastPrice = input.price;
}
function updatePrice(position, stock) {
	const price = stock !== null && Number.isFinite(stock.close) && stock.close > 0 ? stock.close : position.lastPrice;
	position.lastPrice = price;
	position.highestPrice = Math.max(position.highestPrice, price);
	return price;
}
function swingReport(context) {
	const settings = settingsForCapital(context.settings, context.state.cash);
	return buildMarketReport(screen(context.snapshot.universe.stocks, DEFAULT_CRITERIA).matches, DEFAULT_CRITERIA, context.snapshot.universe, context.snapshot.news, settings, context.today, context.now);
}
function etradeReport(context) {
	const settings = settingsForCapital(context.settings, context.state.cash);
	return buildEtradeReport(screen(context.snapshot.universe.stocks, DEFAULT_CRITERIA).matches, context.snapshot.universe, context.snapshot.news, settings, context.today, context.now);
}
function manageSwing(context) {
	const { state, settings } = context;
	const position = state.position;
	if (position === null) return;
	const price = updatePrice(position, stockFor(context.snapshot, position.ticker));
	position.stopPrice = Math.max(position.stopPrice, money(position.highestPrice * (1 - position.stopPct)));
	if (price <= position.stopPrice) {
		executeSell(context, {
			quantity: position.shares,
			price,
			fee: settings.trade.sellFee,
			reason: "Stop"
		});
		return;
	}
	if (position.targetPrice !== null && price >= position.targetPrice) {
		executeSell(context, {
			quantity: position.shares,
			price,
			fee: settings.trade.sellFee,
			reason: "Mål"
		});
		return;
	}
	if ((tradingDaysHeld(position.entryAt, context.now) ?? 0) >= position.maxHoldingDays) executeSell(context, {
		quantity: position.shares,
		price,
		fee: settings.trade.sellFee,
		reason: "Tidsstopp"
	});
}
function openSwing(context) {
	const { state, settings } = context;
	if (context.sold || state.position !== null || state.pending !== null) return;
	const main = swingReport(context).main;
	if (main === null) return;
	const stock = main.candidate.stock;
	const price = stock.close;
	const plan = main.trade;
	if (!plan.feasible || plan.shares <= 0 || price <= 0 || plan.targetPrice <= 0 || plan.stopPrice <= 0) return;
	const categories = main.candidate.categories.length > 0 ? main.candidate.categories.join(", ") : "hovedkandidat";
	const reason = `Swing: ${stock.ticker} – ${categories} (score ${main.candidate.score.toFixed(0)})`;
	executeBuy(context, {
		ticker: stock.ticker,
		shares: plan.shares,
		price,
		fee: settings.trade.buyFee,
		reason,
		stopPrice: plan.stopPrice,
		stopPct: plan.stopPct ?? 1 - plan.stopPrice / price,
		targetPrice: plan.targetPrice,
		targets: [],
		maxHoldingDays: plan.maxHoldingDays ?? 5
	});
}
function manageEtrade(context) {
	const { state, settings } = context;
	const position = state.position;
	if (position === null) return;
	const price = updatePrice(position, stockFor(context.snapshot, position.ticker));
	if (position.stage >= 3) position.stopPrice = Math.max(position.stopPrice, money(position.highestPrice * (1 - position.stopPct)));
	if (price <= position.stopPrice) {
		executeSell(context, {
			quantity: position.shares,
			price,
			fee: settings.trade.sellFee,
			reason: "Stop"
		});
		return;
	}
	while (state.position !== null && state.position.stage < state.position.targets.length) {
		const current = state.position;
		const target = current.targets[current.stage];
		if (target === void 0 || price < target.price) break;
		const plannedExit = etradeExitQuantities(current.originalShares)[current.stage];
		executeSell(context, {
			quantity: Math.min(current.shares, plannedExit ?? current.shares),
			price,
			fee: settings.trade.sellFee,
			reason: target.label
		});
		if (state.position !== null) {
			state.position.stage += 1;
			if (state.position.stage === 1) state.position.stopPrice = Math.max(state.position.stopPrice, state.position.entryPrice);
			else if (state.position.stage === 2) {
				const firstTarget = state.position.targets[0];
				if (firstTarget) state.position.stopPrice = Math.max(state.position.stopPrice, firstTarget.price);
			} else if (state.position.stage === 3) {
				const secondTarget = state.position.targets[1];
				state.position.runnerStartedAt = context.now.toISOString();
				state.position.stopPrice = Math.max(state.position.stopPrice, secondTarget?.price ?? state.position.entryPrice, state.position.highestPrice * (1 - state.position.stopPct));
			}
		}
	}
	if (state.position === null) return;
	const holdStart = state.position.runnerStartedAt ?? state.position.entryAt;
	const holdLimit = state.position.runnerStartedAt ? 10 : state.position.maxHoldingDays;
	if ((tradingDaysHeld(holdStart, context.now) ?? 0) >= holdLimit) executeSell(context, {
		quantity: state.position.shares,
		price,
		fee: settings.trade.sellFee,
		reason: state.position.runnerStartedAt ? "Runner tidsstopp" : "Tidsstopp"
	});
}
function openEtrade(context) {
	const { state, settings } = context;
	if (context.sold || state.position !== null) return;
	const report = etradeReport(context);
	const best = report.ideas[0] ?? null;
	if (state.pending !== null) {
		const pending = state.pending;
		if (!report.ideas.some((idea) => idea.candidate.stock.ticker === pending.ticker)) {
			state.pending = null;
			context.pendingClosed = true;
		} else {
			const stock = stockFor(context.snapshot, pending.ticker);
			if (stock === null) {
				state.pending = null;
				context.pendingClosed = true;
			} else {
				const price = stock.close;
				if (price >= pending.trigger) {
					const levels = etradeLevelsForEntry(price, pending.stopPct);
					executeBuy(context, {
						ticker: pending.ticker,
						shares: pending.shares,
						price,
						fee: settings.trade.buyFee,
						reason: `${pending.reason} (trigger)`,
						stopPrice: levels.stopPrice,
						stopPct: pending.stopPct,
						targetPrice: pending.targetPrice,
						targets: levels.targets.map(({ label, price: targetPrice }) => ({
							label,
							price: targetPrice
						})),
						maxHoldingDays: pending.maxHoldingDays
					});
					return;
				}
				if (pending.invalidation !== null && price <= pending.invalidation) {
					state.pending = null;
					context.pendingClosed = true;
				} else if ((tradingDaysHeld(pending.createdAt, context.now) ?? 0) >= pending.maxHoldingDays) {
					state.pending = null;
					context.pendingClosed = true;
				} else return;
			}
		}
	}
	if (context.pendingClosed || state.position !== null || state.pending !== null || best === null) return;
	const stock = best.candidate.stock;
	const price = stock.close;
	if (best.invalidation !== null && price <= best.invalidation) return;
	const reason = `Etrade: ${stock.ticker} – ${best.setupLabel} (score ${best.score.toFixed(0)})`;
	if (price >= best.trigger) {
		const levels = etradeLevelsForEntry(price, best.stopPct);
		executeBuy(context, {
			ticker: stock.ticker,
			shares: best.shares,
			price,
			fee: settings.trade.buyFee,
			reason: `${reason} (trigger)`,
			stopPrice: levels.stopPrice,
			stopPct: best.stopPct,
			targetPrice: null,
			targets: levels.targets.map((target) => ({
				label: target.label,
				price: target.price
			})),
			maxHoldingDays: best.horizonDays
		});
		return;
	}
	state.pending = {
		ticker: stock.ticker,
		shares: best.shares,
		trigger: best.trigger,
		invalidation: best.invalidation,
		stopPrice: best.stopPrice,
		stopPct: best.stopPct,
		targetPrice: null,
		targets: best.targets.map((target) => ({
			label: target.label,
			price: target.price
		})),
		maxHoldingDays: best.horizonDays,
		score: best.score,
		createdAt: context.now.toISOString(),
		reason
	};
}
function tick(mode, state, snapshot, settings, now, today) {
	const context = {
		mode,
		snapshot,
		settings,
		now,
		today,
		state: {
			cash: money(state.cash),
			position: state.position === null ? null : { ...state.position },
			pending: state.pending === null ? null : { ...state.pending }
		},
		trades: [],
		sold: false,
		pendingClosed: false
	};
	if (mode === "swing") {
		manageSwing(context);
		openSwing(context);
	} else {
		manageEtrade(context);
		openEtrade(context);
	}
	const positionValue = context.state.position === null ? 0 : money(context.state.position.shares * context.state.position.lastPrice);
	return {
		mode,
		state: context.state,
		trades: context.trades,
		equity: {
			cash: money(context.state.cash),
			positionValue,
			equity: money(context.state.cash + positionValue)
		}
	};
}
/**
* Runs one simulated tick for both modes. The caller is responsible for only
* invoking this while the market is open and the snapshot is fresh.
*/
function runSimulatorTick(input) {
	const now = input.now ?? /* @__PURE__ */ new Date();
	const today = input.today ?? now.toISOString().slice(0, 10);
	const results = [];
	for (const mode of ["swing", "etrade"]) {
		const state = input.states[mode] ?? emptyPortfolioState();
		results.push(tick(mode, state, input.snapshot, input.settings, now, today));
	}
	return results;
}
// src/core/market.ts
var SCANNER_COLUMNS = [
	"name",
	"description",
	"close",
	"currency",
	"change",
	"Perf.W",
	"Perf.1M",
	"Perf.3M",
	"Perf.6M",
	"Perf.Y",
	"SMA5",
	"SMA20",
	"SMA50",
	"SMA200",
	"RSI",
	"High.All",
	"price_52_week_high",
	"volume",
	"average_volume_10d_calc",
	"market_cap_basic",
	"sector",
	"exchange",
	"type",
	"typespecs",
	"earnings_release_next_date",
	"dividend_ex_date_upcoming",
	"ATR",
	"open",
	"high",
	"high[1]",
	"low",
	"VWAP"
];
var MarketDataError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "MarketDataError";
	}
};
function normalizeTicker(value) {
	return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function numberValue(value) {
	if (value === null || value === void 0 || typeof value === "boolean") return null;
	const number = Number(value);
	if (!Number.isFinite(number)) return null;
	return number;
}
function percentValue(value) {
	const number = numberValue(value);
	return number === null ? null : number / 100;
}
function dateValue(value) {
	if (value === null || value === void 0 || typeof value === "boolean") return null;
	if (typeof value === "number") {
		if (value <= 0) return null;
		const timestamp = value > 1e11 ? value : value * 1e3;
		return osloDateString(new Date(timestamp));
	}
	if (typeof value === "string") {
		const text = value.trim();
		if (!text) return null;
		if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
		const asNumber = Number(text);
		if (Number.isFinite(asNumber)) return dateValue(asNumber);
	}
	return null;
}
function parseScannerPayload(payload, growthTickers = []) {
	if (!Array.isArray(payload.data)) throw new MarketDataError("Svar fra TradingView mangler 'data'-listen.");
	const growth = new Set(Array.from(growthTickers).map((ticker) => normalizeTicker(ticker)).filter(Boolean));
	const stocks = [];
	for (const row of payload.data) {
		if (!row || !Array.isArray(row.d)) continue;
		const values = /* @__PURE__ */ new Map();
		SCANNER_COLUMNS.forEach((column, index) => values.set(column, row.d?.[index]));
		const symbol = String(row.s ?? "");
		const ticker = String(values.get("name") ?? symbol.split(":").at(-1) ?? "").trim();
		if (!ticker) continue;
		const close = numberValue(values.get("close"));
		if (close === null || close <= 0) continue;
		const name = String(values.get("description") ?? ticker).trim();
		const currency = String(values.get("currency") ?? "NOK").trim();
		const sector = String(values.get("sector") ?? "Ukjent").trim();
		const instrumentType = String(values.get("type") ?? "stock").trim();
		const market = growth.has(normalizeTicker(ticker)) ? "euronext_growth" : "oslo";
		stocks.push({
			ticker,
			name,
			close,
			currency,
			dayReturn: percentValue(values.get("change")),
			weekReturn: percentValue(values.get("Perf.W")),
			monthReturn: percentValue(values.get("Perf.1M")),
			quarterReturn: percentValue(values.get("Perf.3M")),
			sma5: numberValue(values.get("SMA5")),
			sma20: numberValue(values.get("SMA20")),
			sma50: numberValue(values.get("SMA50")),
			rsi: numberValue(values.get("RSI")),
			ath: numberValue(values.get("High.All")),
			high52w: numberValue(values.get("price_52_week_high")),
			marketCap: numberValue(values.get("market_cap_basic")),
			volume: numberValue(values.get("volume")),
			sector,
			instrumentType,
			market,
			earningsDate: dateValue(values.get("earnings_release_next_date")),
			exDividendDate: dateValue(values.get("dividend_ex_date_upcoming")),
			averageVolume10d: numberValue(values.get("average_volume_10d_calc")),
			atr: numberValue(values.get("ATR")),
			open: numberValue(values.get("open")),
			high: numberValue(values.get("high")),
			previousDayHigh: numberValue(values.get("high[1]")),
			low: numberValue(values.get("low")),
			vwap: numberValue(values.get("VWAP"))
		});
	}
	return stocks;
}
// src/core/snapshot.ts
function sourceValue(value) {
	if (value === "cache" || value === "stale-cache") return value;
	return "live";
}
function newsSourceValue(value) {
	if (value === "cache" || value === "stale-cache" || value === "error") return value;
	return "live";
}
function parseBenchmark(data, now) {
	if (!data || data.value === null || data.value === void 0 || !Number.isFinite(data.value) || data.value <= 0) return null;
	return {
		ticker: typeof data.ticker === "string" && data.ticker.trim() ? data.ticker.trim() : "OSEBX",
		name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Oslo Børs Benchmark GI Index",
		value: data.value,
		changePct: typeof data.changePct === "number" && Number.isFinite(data.changePct) ? data.changePct : null,
		fetchedAt: data.fetchedAt ? new Date(data.fetchedAt) : now,
		source: newsSourceValue(data.source),
		warning: data.warning ?? null
	};
}
/**
* Converts the raw Edge Function response into the normalized snapshot used by
* the report generators. Throws when the scanner payload is missing or empty.
*/
function parseMarketSnapshot(data, now = /* @__PURE__ */ new Date()) {
	if (!data || data.error) throw new Error(data?.error ?? "Markedsfunksjonen svarte uten data.");
	if (!data.scan?.payload) throw new Error("Markedssvaret manglet TradingView-data.");
	const growthTickers = new Set(Array.isArray(data.growth?.tickers) ? data.growth.tickers : []);
	const stocks = parseScannerPayload(data.scan.payload, growthTickers);
	if (stocks.length === 0) throw new Error("TradingView returnerte ingen aksjer for Oslo Børs.");
	const newsFetchedAt = data.news?.fetchedAt ? new Date(data.news.fetchedAt) : now;
	const newsSince = data.news?.since ? new Date(data.news.since) : /* @__PURE__ */ new Date(now.getTime() - 864e5);
	let news;
	try {
		news = parseNewsPayload(data.news?.payload, newsSince, newsFetchedAt, newsSourceValue(data.news?.source), data.news?.warning ?? null);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		news = emptyNewsFeed(newsFetchedAt, newsSince, data.news?.warning ? `${data.news.warning} (${message})` : message);
	}
	return {
		universe: {
			stocks,
			fetchedAt: data.scan.fetchedAt ? new Date(data.scan.fetchedAt) : now,
			source: sourceValue(data.scan.source),
			warning: data.scan.warning ?? null,
			growthTickers,
			growthSource: data.growth?.source ? newsSourceValue(data.growth.source) : "ukjent",
			growthWarning: data.growth?.warning ?? null
		},
		news,
		benchmark: parseBenchmark(data.benchmark, now),
		generatedAt: data.generatedAt ? new Date(data.generatedAt) : now
	};
}
export { DEFAULT_SETTINGS, SIM_STARTING_CASH, emptyPortfolioState, marketSession, mergeSettings, osloDateString, parseMarketSnapshot, runSimulatorTick, simulatorMayTick };
