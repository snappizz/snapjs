var xamel = require('xamel');

if (typeof String.prototype.startsWith != 'function') {
    String.prototype.startsWith = function (str) {
        return this.slice(0, str.length) == str;
    };
}

function Translator() {
	this.stage = null;
	this.sprites = {};
	this.spriteNameMappings = {};
}

Translator.prototype.makeSprite = function (el) {
	new Translator.Sprite(el, this);
};

Translator.prototype.toString = function (el) {
	var spriteNames, result, that;
	that = this;
	spriteNames = Object.keys(this.sprites).sort();

	result = 'var ' + spriteNames.join(', ') + ';\n\n';
	result += spriteNames.map(function (spriteName) {
		return that.sprites[spriteName].toString();
	}).join('\n\n');

	return result;
};

/*****************************************************************************/

function toValidJSName(str) {
	// Keep name lowercase
	// All global library functions are in Uppercase, so this prevents collision
	str = str.toLowerCase();
	// Convert spaces to camel case
	str = str.split(/\s+/).map(function (word, i) {
		if (i === 0) {
			return word;
		}
		return word.charAt(0).toUpperCase() + word.slice(1);
	}).join('');
	return str;
}

Translator.Sprite = function (el, owner) {
	var that = this;
	this.owner = owner;

	this.name = toValidJSName(el.attrs.name);
	// Sometimes multiple sprite names will map to one
	// As a last resort we add underscores to ensure uniqueness
	while (this.owner.hasOwnProperty(this.name)) {
		this.name += '_';
	}
	// Add to translator's sprite dictionary and record the mapping
	this.owner.sprites[this.name] = this;
	this.owner.spriteNameMappings[el.attrs.name] = this.name;

	this.scripts = [];
	el.find('scripts/script').forEach(function (script) {
		that.makeScript(script);
	});
};

Translator.Sprite.prototype.makeScript = function (el) {
	this.scripts.push(new Translator.Script(el, this, true));
};

Translator.Sprite.prototype.toString = function () {
	var result;
	result = this.name + ' = new Sprite();\n\n';
	result += this.scripts.join('\n\n');
	return result;
};

/*****************************************************************************/

Translator.Script = function (el, owner, isHeader) {
	this.owner = owner;
	this.blocks = [];
	this.isHeader = !!isHeader;
	el.map(function (block) {
		this.makeBlock(block);
	}.bind(this));
};

Translator.Script.prototype.toString = function (mode) {
	var lines, that;
	that = this;
	lines = this.blocks.map(function (b) {
        return b.toString('statement');
    }).join('\n').split('\n');
	lines = lines.map(function (line) { return '\t' + line; });
	if (this.isHeader) {
		if (this.blocks[0].type === 'receiveGo') {
			lines[0] = this.owner.name + ".onReceiveGo(function () {";
			lines.push('});');
			return lines.join('\n');
		} else if (this.blocks[0].type === 'receiveClick') {
			lines[0] = this.owner.name + ".onReceiveClick(function () {";
			lines.push('});');
			return lines.join('\n');
		} else {
			lines[0] = this.owner.name + ".onReceiveMessage(function () {";
			lines.push('});');
			return lines.join('\n');
		}
	} else {
        // The mode 'block' indicates that we only want to encase the function body in curly braces, rather than function () {}.
        // This is useful when we're using a bare control structure like if-else.
		if (mode === 'block') {
            lines.unshift('{');
            lines.push('}');
        } else {
			lines.unshift('function () {');
			lines.push('}');
		}
		return lines.join('\n');
	}
};

Translator.Script.prototype.makeBlock = function (el) {
	this.blocks.push(new Translator.Block(el, this));
};

/*****************************************************************************/

Translator.Block = function (el, owner) {
	this.owner = owner;
	this.type = el.attrs.s;
	this.args = el.children.map(function (arg) {
		if (arg.name === 'l') {
			return arg.children[0];
		} else if (arg.name === 'color') {
			return 'new Color(' + arg.children[0].split(',').join(', ') + ')';
		} else if (arg.name === 'block') {
			return new Translator.Block(arg, owner);
		} else if (arg.name === 'script') {
			return new Translator.Script(arg, owner);
		} else {
			console.warn('Unidentified block type ' + arg.name);
			console.log(arg);
		}
	});
};

// A template is either a raw_template or an array [raw_template, flags]
// A raw_template is either a function or a string.
// The only flag supported at the moment is 'o', which means "this block may need to be wrapped in parentheses."
// A function raw_template is called with the template args, and the current block 
// A string raw_template has substitution parameters. Examples:
// $1 = first argument
// $p2 = second argument, wrapped in parentheses when it is a block marked 'o'
// $b1 = first argument, a Script, represented as a raw block surrounded by curly brackets
// $s1 = second argument as a string literal
Translator.Block.templates = {
    reportSum: ['$p1 + $p2', 'o'],
    reportDifference: ['$p1 - $p2', 'o'],
    reportProduct: ['$p1 * $p2', 'o'],
    reportQuotient: ['$p1 / $p2', 'o'],
    reportRandom: 'random($1, $2)',
    reportLessThan: ['$p1 < $p2', 'o'],
    reportEquals: ['$p1 == $p2', 'o'],
    reportGreaterThan: ['$p1 > $p2', 'o'],
    reportNot: ['!$p1', 'o'],
    reportAttributeOf: '$p2[$s1]',
    reportTrue: 'true',
    reportFalse: 'false',
    reportAnd: ['$p1 && $p2', 'o'],
    reportOr: ['$p1 || $p2', 'o'],
    reportMap: '$p1.map(function (item) { $p2(item) })',
    doForever: 'while (true) $b1',
    doRepeat: '($1).times($2)',
    doUntil: 'while (!($1)) $b2',
    doIf: 'if ($1) $b2',
    doIfElse: 'if ($1) $b2 else $b3'
};

function innerParenthesize(arg) {
    var template;
    if (arg instanceof Translator.Block) {
        template = Translator.Block.templates[arg.type];
        if (template && template instanceof Array && ~template[1].indexOf('o')) {
            arg = '(' + arg.toString() + ')';
        }
    }
    return arg.toString();
}

function dollarFormat(str, args) {
    return str.replace(/\$(\w*)\d+/g, function (match) {
        var m, flags, index, arg, template;
        m = match.match(/^\$(\w*)(\d+)$/);
        flags = m[1];
        index = m[2];
        arg = args[+m[2] - 1];
        if (~flags.indexOf('b')) {
            arg = arg.toString('block');
        }
        if (~flags.indexOf('s')) {
            arg = JSON.stringify(arg.toString());
        }
        if (~flags.indexOf('p')) {
            arg = innerParenthesize(arg);
        }
        return arg;
    });
}

Translator.Block.prototype.toString = function (mode) {
	var result, type, template, tflags, that;
	that = this;
    type = this.type;
	if (Translator.Block.templates.hasOwnProperty(type)) {
        template = Translator.Block.templates[type];
        tflags = {};
        if (template instanceof Array) {
            template = template[0];
        }
        if (typeof template === 'string') {
            result = dollarFormat.call(this, template, this.args);
        } else if (typeof template === 'function') {
            result = template.apply(this, this.args);
        }
	} else {
		result = 'this.' + type + '(';
		if (this.args.length > 0) {
			result += this.args.join(', ');
		}
		result += ')';
        if (mode === 'statement') {
            result += ';';
        }
	}
	return result;
};

/*****************************************************************************/

function snap2js(xml, callback) {
	xamel.parse(xml, function (err, xml) {
		var translator;
		translator = new Translator();
		//sprites = xml.find('project/stage');
		xml.find('snapdata/project/stage/sprites/sprite').forEach(function (sprite) {
			translator.makeSprite(sprite);
		});
		if (callback instanceof Function) {
			callback(translator.toString());
		}
	});
}
module.exports = snap2js;

function main() {
	var str;
	str = require('fs').readFileSync('test/sampleproject.xml').toString();
	snap2js(str, function (code) {
		console.log(code);
	});
}

if (require.main === module) {
	main();
}