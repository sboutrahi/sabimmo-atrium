const CommonTags = require('common-tags');
const QueryString = require('querystring');
const oneLineTrim = CommonTags.oneLineTrim;

const DEFAULT_ADD_USER_BODY_STR = oneLineTrim
`T_user_cmd=add&
T_user_id=-1&
T_user_fn=&
T_user_ln=&
T_user_lang=0&
T_user_a_yr=&
T_user_a_month=&
T_user_a_day=&
T_user_a_hr=&
T_user_a_min=&
T_user_yr=&
T_user_month=&
T_user_day=&
T_user_hr=&
T_user_min=&
T_user_en=1&
T_user_program=0&
T_user_ext_dly=0&
T_user_o_anti=0&
T_user_o_inter=0&
T_user_can_arm=0&
T_user_can_disarm=0`;

const DEFAULT_SET_KEYCODE_BODY_STR = oneLineTrim
`T_user_id=&
T_user_code_cmd=add&
T_user_code_num=&
T_user_code_ld_act=0&
T_user_code_ld_deact=0&
T_user_code_ld_over=0&
T_user_code_ld_ack=0`

const DEFAULT_SET_ACCESS_LEVEL_BODY_STR = oneLineTrim
`
T_access_cmd=add&
T_access_user_id=&
T_access_id=1`


module.exports.DEFAULT_ADD_USER_BODY_PARSED = QueryString.parse(DEFAULT_ADD_USER_BODY_STR);
module.exports.DEFAULT_SET_BODY_KEYCODE_PARSED = QueryString.parse(DEFAULT_SET_KEYCODE_BODY_STR);
module.exports.DEFAULT_SET_ACCESS_LEVEL_BODY_PARSED = QueryString.parse(DEFAULT_SET_ACCESS_LEVEL_BODY_STR);