/*!
 * RC4 Implementation
 * http://www.java2s.com/Code/JavaScript/Security/RC4EncryptioninJavaScript.htm
 */
function rc4(key, text) {
    s = new Array();
    for (var i = 0; i < 256; i++) {
        s[i] = i;
    }
    var j = 0;
    var x;
    for (i = 0; i < 256; i++) {
        j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
        x = s[i];
        s[i] = s[j];
        s[j] = x;
    }
    i = 0;
    j = 0;
    var ct = '';
    for (var y = 0; y < text.length; y++) {
        i = (i + 1) % 256;
        j = (j + s[i]) % 256;
        x = s[i];
        s[i] = s[j];
        s[j] = x;
        ct += (text.charCodeAt(y) ^ s[(s[i] + s[j]) % 256]).toString(16).pad("0", 2).toUpperCase(); /*ct += String.fromCharCode((text.charCodeAt(y) ^ s[(s[i] + s[j]) % 256]));*/
    }
    return ct;
}
 
function rc4Decrypt(key, text) {
    var s = new Array();
    for (var i = 0; i < 256; i++) {
        s[i] = i;
    }
    var j = 0;
    var x;
    for (i = 0; i < 256; i++) {
        j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
        x = s[i];
        s[i] = s[j];
        s[j] = x;
    }
    i = 0;
    j = 0;
    var ct = '';
    if (0 == (text.length & 1)) {
        for (var y = 0; y < text.length; y += 2) {
            i = (i + 1) % 256;
            j = (j + s[i]) % 256;
            x = s[i];
            s[i] = s[j];
            s[j] = x;
            ct += String.fromCharCode((parseInt(text.substr(y, 2), 16) ^ s[(s[i] + s[j]) % 256]));
        }
    }
    return ct;
}
/*!
 * Post Checksum Calculator
 */
function postChkCalc(str) {
    var chk = 0;
    for (var i = 0; i < str.length; i++) {
        chk += str.charCodeAt(i);
    }
    return (chk & 0xFFFF).toString(16).pad("0", 4).toUpperCase();
}
/*!
 * String Padding Function
 */
String.prototype.pad = function (inC, inL) {
    var str = this;
    while (str.length < inL) {
        str = inC + str;
    }
    return str;
}



module.exports.rc4Decrypt = rc4Decrypt;
module.exports.rc4 = rc4;
module.exports.postChkCalc = postChkCalc;