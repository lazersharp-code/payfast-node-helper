const crypto = require("crypto");
const axios = require('axios').default;

const createSubscriptionHeaders = (merchant_id, passPhrase, body) => {
    const timestamp = new Date().toISOString();
    return {
        'merchant-id': merchant_id,
        'version': 'v1',
        'timestamp': timestamp,
        'signature': hash(Object.keys({
            'merchant-id': merchant_id,
            'passphrase': passPhrase,
            'version': 'v1',
            'timestamp': timestamp,
            ...body
        })
            .sort())
    }
}

const SERVER_VALIDATION = {
    "COMPLETE": 'COMPLETE',
    "CANCELLED": 'CANCELLED'
}

class PayfastSubscriptionHandler {
    constructor(merchantId, passPhrase, sandbox) {

        if (!merchantId) {
            throw "Please enter your merchant_id"
        }
        if (!passPhrase) {
            throw "Please enter your passPhrase"
        }

        // populate payfast data
        this.passPhrase = passPhrase;
        this.sandbox = sandbox;
        this.payfastData = {
            merchant_id: merchantId,
        }
    }

    async cancelSubscription(pfToken) {
        if (!pfToken) {
            throw "Please enter your pfToken"
        }
        try {
            await axios({
                url: `https://api.payfast.co.za/subscriptions/${pfToken}/cancel${this.sandbox ? '?testing=true' : ''}`,
                method: 'PUT',
                headers: {
                    ...createSubscriptionHeaders(this.merchantId, this.passPhrase)
                }
            })
            return true;
        } catch (err) {
            throw err;
        }
    }

    async validateITN(req) {

        const pfHost = this.sandbox ? "sandbox.payfast.co.za" : "www.payfast.co.za";

        const pfData = JSON.parse(JSON.stringify(req.body));

        let pfParamString = "";
        for (let key in pfData) {
            if (pfData.hasOwnProperty(key) && key !== "signature") {
                pfParamString += `${key}=${encodeURIComponent(pfData[key].trim()).replace(/%20/g, "+")}&`;
            }
        }

        // Remove last ampersand
        pfParamString = pfParamString.slice(0, -1);

        const pfValidSignature = (pfData, pfParamString, pfPassphrase = null) => {
            // Calculate security signature
            let tempParamString = '';
            if (pfPassphrase !== null) {
                pfParamString += `&passphrase=${encodeURIComponent(pfPassphrase.trim()).replace(/%20/g, "+")}`;
            }

            const signature = crypto.createHash("md5").update(pfParamString).digest("hex");
            return pfData['signature'] === signature;
        };

        async function ipLookup(domain) {
            return new Promise((resolve, reject) => {
                require('dns').lookup(domain, { all: true }, (err, address, family) => {
                    if (err) {
                        reject(err)
                    } else {
                        const addressIps = address.map(function (item) {
                            return item.address;
                        });
                        resolve(addressIps);
                    }
                });
            });
        }

        const pfValidIP = async (req) => {
            const validHosts = [
                'www.payfast.co.za',
                'sandbox.payfast.co.za',
                'w1w.payfast.co.za',
                'w2w.payfast.co.za'
            ];

            let validIps = [];
            const pfIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

            try {
                for (let key in validHosts) {
                    const ips = await ipLookup(validHosts[key]);
                    validIps = [...validIps, ...ips];
                }
            } catch (err) {
                console.error(err);
            }

            const uniqueIps = [...new Set(validIps)];

            if (uniqueIps.includes(pfIp)) {
                return true;
            }
            return false;
        };

        const pfValidPaymentData = (cartTotal, pfData) => {
            return Math.abs(parseFloat(cartTotal) - parseFloat(pfData['amount_gross'])) <= 0.01;
        };

        const pfValidServerConfirmation = async (pfHost, pfParamString) => {
            const result = await axios.post(`https://${pfHost}/eng/query/validate`, pfParamString)
                .then((res) => {
                    return res.data;
                })
                .catch((error) => {
                    console.error(error)
                });
            return result === 'VALID';
        };

        const check1 = pfValidSignature(pfData, pfParamString, passPhrase);
        const check2 = pfValidIP(req);
        const check3 = pfValidPaymentData(cartTotal, pfData);
        const check4 = pfValidServerConfirmation(pfHost, pfParamString);

        if (check1 && check2 && check3 && check4) {
            return {
                passed: true,
                status: pfData.payment_status === SERVER_VALIDATION.COMPLETE ? SERVER_VALIDATION.COMPLETE : SERVER_VALIDATION.CANCELLED,
                data: pfData
            }
        } else {
            // Some checks have failed, check payment manually and log for investigation
            return {
                passed: false,
            }
        }
    }

    async updateSubscription(pfToken, paymentData = {
        cycles: '',
        amount: '',
        run_date: '',
        frequency: ''
    }) {
        if (!pfToken) {
            throw "Please enter your pfToken"
        }
        try {
            await axios({
                url: `https://api.payfast.co.za/subscriptions/${pfToken}/pause${this.sandbox ? '?testing=true' : ''}`,
                method: 'PUT',
                headers: {
                    ...createSubscriptionHeaders(this.merchantId, this.passPhrase, paymentData)
                },
                data: {
                    ...paymentData
                }
            })
            return true;
        } catch (err) {
            throw err;
        }
    }

    async pauseSubscription(pfToken, cycles) {
        if (!pfToken) {
            throw "Please enter your pfToken"
        }
        try {
            await axios({
                url: `https://api.payfast.co.za/subscriptions/${pfToken}/pause${this.sandbox ? '?testing=true' : ''}`,
                method: 'PUT',
                headers: {
                    ...createSubscriptionHeaders(this.merchantId, this.passPhrase, body)
                },
                data: {
                    cycles: cycles || '1',
                }
            })
            return true;
        } catch (err) {
            throw err;
        }
    }

    async unpauseSubscription(pfToken) {
        if (!pfToken) {
            throw "Please enter your pfToken"
        }
        try {
            await axios({
                url: `https://api.payfast.co.za/subscriptions/${pfToken}/unpause${this.sandbox ? '?testing=true' : ''}`,
                method: 'PUT',
                headers: {
                    ...createSubscriptionHeaders(this.merchantId, this.passPhrase)
                }
            })
            return true;
        } catch (err) {
            throw err;
        }
    }

    async getSubscription(pfToken) {
        if (!pfToken) {
            throw "Please enter your pfToken"
        }
        try {
            const subscription = await axios({
                url: `https://api.payfast.co.za/subscriptions/${pfToken}/fetch${this.sandbox ? '?testing=true' : ''}`,
                method: 'GET',
                headers: {
                    ...createSubscriptionHeaders(this.merchantId, this.passPhrase)
                }
            })
            return subscription.data;
        } catch (err) {
            throw err;
        }
    }
}


module.exports = { PayfastSubscriptionHandler, SERVER_VALIDATION };

