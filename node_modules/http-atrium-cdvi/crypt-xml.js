const rc4 = require('./rc4').rc4;
const rc4Decrypt = require('./rc4').rc4Decrypt;
const postChkCalc = require('./rc4').postChkCalc;

var encryptXml = function(xmlData, key){
    if (key !== null) {
        var strRaw = xmlData;
        xmlData = "post_enc=" + rc4(key, strRaw) + "&post_chk=" + postChkCalc(strRaw);
    }
    return xmlData;
}

var encryptXmlToList = function(xmlData, key){
    if (key !== null) {
        var strRaw = xmlData;
        return [rc4(key, strRaw), postChkCalc(strRaw)];
    }
}
 
var decryptXml = function(xmlData, key){
    var postEnc = "post_enc=";
    var IdxEnc = xmlData.search(postEnc);
    if (IdxEnc >= 0){
        IdxEnc = IdxEnc + postEnc.length;
        var postChk = "&post_chk=";
        var IdxChk = xmlData.search(postChk);
        if (IdxChk >= 0){
            var chkSumPost = xmlData.substr(IdxChk + postChk.length);
            xmlData = xmlData.substr(IdxEnc, (IdxChk - IdxEnc));
            if (key !== null) {
                xmlData = rc4Decrypt(key, xmlData);
                var chkSumCalc = postChkCalc(xmlData);
                chkSumCalc = parseInt(chkSumCalc, 16);
                chkSumCalc &= 65535;
                chkSumPost = parseInt(chkSumPost, 16);
                if (chkSumPost == chkSumCalc){
                    return xmlData;
                }
            }
        }
        return null;
    }
    return xmlData;
}

module.exports.encryptXml = encryptXml;
module.exports.encryptXmlToList = encryptXmlToList;
module.exports.decryptXml = decryptXml;