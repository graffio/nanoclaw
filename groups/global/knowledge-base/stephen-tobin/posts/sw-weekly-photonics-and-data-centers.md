---
title: "SW Weekly: Photonics and Data Centers"
date: 2026-04-19
slug: sw-weekly-photonics-and-data-centers
url: https://stephentobin.substack.com/p/sw-weekly-photonics-and-data-centers
type: post
post_type: sw_weekly
audience: only_paid
tickers: [ALMU, AEHR, POET, LWLG, EH, ASPI, WRD, PONY, GRA, HSAI, ROOF, EOS, ABAT, AUR, MDA, DRO, MTM, SOUN, KDK, AREC, TEM, QBTS, CMPS, NRXP, "0425", VOYG, NOW]
---

Last week, [I started looking at new technologies](https://stephentobin.substack.com/p/sw-weekly-companies-driving-next) integral to the development of cost-effective, large-scale data centers. I looked at the move towards 800V architecture and at companies trying to provide the new materials required to replace Silicon, as well as those trying to deliver sufficient power to the GPU.

Today, I look at how Photonics and fiber optics are replacing copper, solving a problem similar to last week's. Copper cannot withstand the heat generated and loses too much energy.

This work is a typical example of the Strategic Waves funnel. Technologies are at the top of the funnel. I look into them and their potential, then look at the companies involved before deciding whether one is suitable for investment. The plan has a strict set of rules: it aims to identify smaller companies with disruptive technology, but those companies must have a moat. It is no good having a great technology seemingly much better than current technology if it can be easily copied by the incumbent large-scale producers.

## First Performance

The portfolio made a solid move this week, outperforming the markets and delivering a decent profit. Twenty of our 23 stocks increased in value, with 12 delivering double-figure percentage gains. Quantum and autonomous trucking were the best performers, and recycling was the worst.

**Portfolio chart (week Apr 10–17):** Portfolio +12.9% vs S&P 500 (US) +4.5%

*Source image: [https://substack-post-media.s3.amazonaws.com/public/images/ab9742b7-e0c4-49fd-a59f-fac92b58c495_1083x416.png](https://substack-post-media.s3.amazonaws.com/public/images/ab9742b7-e0c4-49fd-a59f-fac92b58c495_1083x416.png)*

[I bought one stock last week](https://stephentobin.substack.com/p/trade-alert-profiting-from-the-carnage), it's currently down 2%. The trading outlook remains unclear, the situation in Iran remains fluid, so for the next week, I will continue with my more cautious outlook. I expect to add one company to the portfolio next week and am close to closing one of the more profitable investments.

## Datacenters and Photonics

The datacenter industry is currently at an inflection point, traditional copper-based interconnects can no longer meet the bandwidth and power demands of AI workloads.

In response, a massive transition toward photonics—using light instead of electrons for data transmission—is underway, from long-haul data center interconnects to chip-level optical connections photons are being deployed.

The use case involves the conversion of electrical signals into optical signals using lasers and modulators, transmitting them over fiber, and converting them back at the destination. This is currently done with pluggable transceivers, but the industry is moving toward more integrated architectures like Co-Packaged Optics (CPO) and Linear Pluggable Optics (LPO) to reduce power and latency.

Photonics offer several advantages over traditional copper wires. They will allow data rates to increase from 100G to 400G, 800G, and eventually 1.6T to 6.4T per connection. They can reduce power consumption by 25-30% compared to traditional electronic networking. Optical switching and interconnects can reduce latency by 15-20%, and Fiber supports longer transmission distances (up to 20 km) without the signal degradation seen in copper.

Photonics does have disadvantages: optical components, especially lasers, are more prone to failure than copper-based components, usually requiring replacement every year. They are very difficult to manufacture to the sub-micron tolerances required, and scaling manufacturing is expensive. Integrating optical engines with high-power GPUs generates significant heat that is difficult to manage, and they are still expensive. Indium Phosphate lasers and digital signal processors are coming down in price but legacy equipment is much cheaper.

### Big Players

In an industry so massive, the established players are likely to work hard to protect their market. Key players in photonics are:

**NVIDIA:** Emerging as a major investor and integrator, NVIDIA is moving beyond GPUs to invest billions in the photonics supply chain to build "gigawatt-scale AI factories."

**Broadcom:** A leader in CPO and custom AI accelerators, collaborating with NTT and OpenAI on next-generation switches.

**Marvell:** Focused on its "3D SiPho engine" and optical DSPs, Marvell is aggressively expanding its footprint in scale-up and scale-out networking.

**Coherent & Lumentum:** These are the "Big Two" in laser manufacturing, providing the Indium Phosphide (InP) EML and CW lasers that power the entire ecosystem. Coherent was a key part of last week's report; it is the darling of Wall Street for this play.

## Small Caps

At the moment, several smaller companies are developing unique substrates, equipment, and novel architectures to carve out a share of this market. The most promising small caps in this space:

| Company | Ticker | Area of Focus | Key Details |
|---------|--------|---------------|-------------|
| Aeluma | ALMU | Quantum dot lasers & InGaAs-on-silicon | Technology uses 200mm/300mm silicon substrates, offering cost advantages over legacy 3" InP wafers. High-speed photodetectors targeting 100G to 400G per lane using wafer-scale manufacturing. |
| Aehr Test Systems | AEHR | Wafer-level burn-in (WLBI) | Provides critical test systems to weed out bad silicon photonics devices before expensive packaging; recently won a major new hyperscale customer. |
| POET Technologies | POET | Optical Interposer platform | Developed chip-scale integration for 800G/1.6T transceivers and "ELSFP" light sources for AI connectivity. |
| Salience Labs | (private) | Photonic-based Optical Circuit Switches | Partnered with Tower Semiconductor to manufacture ultra-low latency optical switches for AI infrastructure. |
| Lightwave Logic | LWLG | Electro-optic polymers | Developing proprietary polymer materials to enable faster modulators (200G+ per lane) with lower power. |
| Sivers Semiconductors | (SIVE.ST) | Laser arrays | Focusing on photonics for datacenters to overcome speed and bandwidth bottlenecks. |
| Riber | ALRIB | Molecular Beam Epitaxy (MBE) | Manufacturing equipment (ROSIE project) used to create the thin films for photonic chips. |
| Soitec | SOI | Silicon-on-Insulator (SOI) substrates | Dominates the 300mm silicon photonics substrate market with a 95% share. |

*Source image: [https://substack-post-media.s3.amazonaws.com/public/images/fa6166b6-efea-43cb-a88c-9d1438535efe_1438x704.png](https://substack-post-media.s3.amazonaws.com/public/images/fa6166b6-efea-43cb-a88c-9d1438535efe_1438x704.png)*

### 2026 Megadeals

A series of partnerships, investments, and orders have dominated newsflow this year and point to the potential for this industry. They also suggest consolidation is likely.

- **NVIDIA Investments:** On March 2, 2026, NVIDIA announced **\$2 billion** investments each into **Coherent** and **Lumentum** to secure supply and R&D for next-generation optics.
- **NVIDIA & Marvell:** A **\$2 billion** strategic partnership was announced in March 2026 to integrate Marvell's custom silicon and optical interconnects with NVIDIA's NVLink ecosystem.
- **Meta & Corning:** Meta committed to a **\$6 billion** procurement of optical fiber cables from **Corning** through 2030 to build its AI data center infrastructure.
- **Marvell & Celestial AI:** Marvell acquired **Celestial AI** for **\$3.25 billion** in December 2025 to gain its "Photonic Fabric" technology.
- **Tower Semiconductor & Salience Labs:** A partnership announced in February 2026 to mass-manufacture Photonic Integrated Circuit (PIC) based optical switches.
- **GlobalFoundries:** Reported doubling its silicon photonics revenue to **\$200 million** in 2025, with plans to reach a **\$1 billion** run rate by 2028.

### Growth Forecasts

The AI datacenter laser chip market is forecast to pass \$10 billion by 2030, with a 70% CAGR.

- **CPO Ramp:** The scale-out CPO market is estimated to grow from less than \$500 million in 2025 to **\$19 billion** by 2029.
- **Shipment Volume:** Silicon photonics semiconductor shipments are expected to reach **367 million units** by 2030.
- **Optical Circuit Switching (OCS):** The OCS TAM is projected to grow 6x, from \$1.2 billion in 2025 to **\$6 billion** by 2029, with Google leading deployment.
- **Speed Transition:** 800G is expected to be the primary growth driver through 2026, with **1.6T and 3.2T** architectures beginning to see broader adoption in new data centers by 2027.
- **Regional Shifts:** While Chinese firms like **CIG Shanghai** and **Jonhon Optronic** are aggressively expanding, there is a counter-trend toward "Western" manufacturing due to geopolitical risks, benefiting companies like **Applied Optoelectronics** and **STMicroelectronics**.

I have now covered two technologies at the top of my funnel related to data centers, but there are two others of immediate interest.

**Cooling:** Air cooling is approaching its physical limits, and new technologies are arriving, including direct-to-chip cold plates, immersion cooling, and the new two-phase cooling system.

**Power:** the public grid cannot meet these electricity demands, and on-site power generation is becoming a necessity. Key technologies are gas turbines, fuel cells, battery storage, and nuclear.

When I have looked at the other two areas, I will take some of the technologies to the next stage of the funnel. At that point, I will try to determine which, if any, will be vulnerable to disruption from the emerging companies' technology. I want a technological moat around my investments, preferring companies with a longer-term future.

---

## The Portfolio

I have started to populate the current view column following the pullback. I am not convinced the pullback is at an end. Pre-Buy means I am looking for an opportunity to add, and Exit Near means I think the likelihood of an exit is increasing. Of course, I will not take any action without first sending a buy alert.

A key element of the plan is being in good companies, and they typically lead the market higher when the inevitable bounce occurs. We have seen this week, and should the bounce continue, I would expect the companies we own to outperform.

**Holdings spreadsheet (as of 2026-04-19):**

| May Rebound View | Name | Ticker | Local \$ Invested | US\$ Invested | Open Profit Local\$ | Total Return | Positions Taken | 7 Day Return | Shares Bought | Avg Buy Price | Latest Price |
|-----------------|------|--------|------------------|--------------|--------------------|--------------|-----------------|--------------|-----------|--------------------|-------------|
| | EHang Holdings Ltd - ADR | EH | 674 | 674 | -131 | -19% | 3 | 7% | 47 | \$14.35 | \$11.55 |
| | ASP Isotopes Inc | ASPI | 981 | 981 | -310 | -32% | 3 | 6% | 125 | \$7.85 | \$5.37 |
| | WeRide Inc - ADR | WRD | 647 | 647 | -23 | -4% | 3 | 8% | 76 | \$8.51 | \$8.21 |
| | Pony AI Inc - ADR | PONY | 682 | 682 | -98 | -14% | 3 | 16% | 50 | \$13.64 | \$11.69 |
| | NanoXplore Inc | TSE:GRA | 697 | 506 | -97 | -14% | 1 | 0% | 270 | \$2.58 | \$2.22 |
| | Hesai Group - ADR | HSAI | 1068 | 1068 | 165 | 15% | 3 | 4% | 53 | \$20.14 | \$23.25 |
| Exit Near | Northstar Clean Technologies Inc | CVE:ROOF | 425 | 308 | -175 | -41% | 1 | -9% | 1250 | \$0.34 | \$0.20 |
| | Electro Optic Systems Holdings Ltd | ASX:EOS | 1033 | 741 | 977 | 95% | 2 | 14% | 195 | \$5.30 | \$10.31 |
| | American Battery Technology Co | ABAT | 502 | 502 | -94 | -19% | 1 | 16% | 120 | \$4.18 | \$3.40 |
| | Aurora Innovation Inc | AUR | 495 | 495 | 85 | 17% | 1 | 22% | 110 | \$4.50 | \$5.27 |
| Exit Near | MDA Space Ltd | TSE:MDA | 710 | 515 | 638 | 90% | 1 | 12% | 28 | \$25.36 | \$48.15 |
| | DroneShield Ltd | ASX:DRO | 1276 | 915 | 259 | 20% | 2 | 7% | 425 | \$3.00 | \$3.61 |
| | Metallium Ltd | ASX:MTM | 760 | 545 | -216 | -28% | 1 | 10% | 800 | \$0.95 | \$0.68 |
| | SoundHound AI Inc | SOUN | 600 | 600 | -164 | -27% | 1 | 18% | 54 | \$11.11 | \$8.08 |
| Pre-Buy | Kodiak AI Inc | KDK | 313 | 313 | 29 | 9% | 1 | 40% | 33 | \$9.49 | \$10.38 |
| | American Resources Corp | AREC | 327 | 327 | -158 | -48% | 1 | 5% | 75 | \$4.36 | \$2.26 |
| Pre-Buy | Tempus AI Inc | TEM | 613 | 613 | -110 | -18% | 1 | 22% | 9 | \$68.14 | \$55.87 |
| | D-Wave Quantum Inc | QBTS | 629 | 629 | 22 | 4% | 1 | 48% | 30 | \$20.95 | \$21.69 |
| | Compass Pathways PLC | CMPS | 602 | 602 | -136 | -23% | 1 | 15% | 70 | \$8.60 | \$6.66 |
| | NRX Pharmaceuticals Inc | NRXP | 594 | 594 | 248 | 42% | 1 | 12% | 330 | \$1.80 | \$2.55 |
| | Minth Group Ltd | HKG:0425 | 3880 | 496 | -268 | -7% | 1 | -7% | 100 | \$38.80 | \$36.12 |
| | Voyager Technologies | VOYG | 559 | 559 | 36 | 6% | 1 | 4% | 19 | \$29.43 | \$31.31 |
| | ServiceNow Inc | NOW | 494 | 494 | -10 | -2% | 1 | 9% | 5 | \$98.73 | \$96.66 |

*Source image: [https://substack-post-media.s3.amazonaws.com/public/images/1a36356e-accb-4c39-aade-d6c0d2dac75c_919x659.png](https://substack-post-media.s3.amazonaws.com/public/images/1a36356e-accb-4c39-aade-d6c0d2dac75c_919x659.png)*

The account looks a little healthier with the unrealized gain now positive. We have managed this pullback reasonably well. I think we cut a few companies that looked in danger of a serious collapse and did manage to avoid some drawdown, but EVTL did come roaring back.

**Monthly performance table (Year 3):**

| Month | Account Return | Profit from Trading | Cash Deposit | Cash Balance | Shares Value | Total Assets | % Cash |
|-------|---------------|--------------------|--------------|-----------|-----------|-----------|----|
| Jan 2026 | 0.54% | \$100 | \$250 | \$5,625 | \$13,122 | \$18,747 | 30% |
| Feb 2026 | -2.53% | -\$481 | \$250 | \$3,428 | \$15,088 | \$18,516 | 19% |
| Mar 2026 | -11.45% | -\$2,149 | \$250 | \$5,255 | \$11,362 | \$16,617 | 32% |
| Apr 2026 (MTD) | 11.74% | \$1,981 | \$250 | \$4,453 | \$14,395 | \$18,848 | 24% |

*Source image: [https://substack-post-media.s3.amazonaws.com/public/images/e972e4a7-4d38-43ef-9c36-d165bde18354_996x699.png](https://substack-post-media.s3.amazonaws.com/public/images/e972e4a7-4d38-43ef-9c36-d165bde18354_996x699.png)*

I am looking to increase my exposure to eVTOL again; this is the time to be investing. I think I like the industry a lot. It has the potential to disrupt an enormous market, and legacy aircraft manufacturers have decided to stay out, leaving it open for emerging companies to fight it out.

The question is which to invest in? Last time it was EVTL, but that original thesis failed for two reasons: I thought they could make the 2027 certification, which is not going to happen, and I assumed they were going for certification with the VX4, which turned out not to be the case. It means they can't start real testing until they build the new aircraft. We made a lot of money in JOBY, and they are still leading the pack, but management recently admitted they can't accommodate 4 passengers and baggage with the current airplane.

I prefer to buy for two reasons: companies first, and the best.

I am digging into all of these issues and hope to buy before the end of next week. I have an interview lined up for Wednesday with a former Wisk engineer who now works as a consultant — he is charging me \$200 for 30 mins so hopefully he has something good to say.

Several watch lists performed well this week: Batteries (13 holdings +13%), Clean Energy (17 holdings +12%), and eVTOL (6 Holdings +12%), all keeping pace with the SW Trading portfolio. I would like one company from each of those to add to the portfolio.

## Weekly Business Digest: April 11 – April 18, 2026

### ASP Isotopes (ASPI)

ASP Isotopes provided a comprehensive business update on April 13, 2026, highlighting significant operational progress across its nuclear medicine, electronics, and nuclear energy platforms.

- **Operational Milestones:** The company expects its first commercial shipments of **Silicon-28**, **Carbon-14**, and **Ytterbium-176** to occur during 2026.
- **Strategic Growth:** ASP Isotopes has expanded its international footprint by acquiring two radiopharmacies in the United States. Additionally, Phase 1 drilling at the **Virginia Gas Project** was completed ahead of schedule, with nameplate capacity for helium expected in Q3 2026.
- **Financial Outlook:** For the full year ended December 31, 2025, product revenue increased 46.15% to \$5.70 million. Net loss of \$175.10 million for 2025. Long-term **EBITDA target** of greater than \$300.00 million by 2031.

### Aurora Innovation (AUR)

Aurora Innovation announced on April 15, 2026, that it will release its first-quarter 2026 financial results after the market close on **May 6, 2026**.

### Compass Pathways (CMPS)

On April 14, 2026, Compass Pathways announced the launch of a U.S. grant program to support the creation of post-approval training for providers of **COMP360**, its investigational psilocybin treatment. Plans to award grants to up to three organizations. Applications accepted through May 14, 2026.

### Electro Optic Systems (ASX: EOS)

EOS released its 2025 Annual Report on April 17, 2026, detailing a successful three-year turnaround — the company is now debt-free.

- **Financial Results:** Revenue from continuing operations \$128.50 million. Net profit attributable to equity holders \$18.61 million. Unconditional backlog order book \$459.10 million as of December 31, 2025.
- **Strategic Developments:** Commitment for a \$100.00 million two-year secured term loan facility. Potential acquisition of **MARSS** (command-and-control systems provider). World's first export order for a 100 kW high-energy laser defense system.

### MDA Space (MDA)

On April 14, 2026, MDA Space will release first-quarter 2026 financial results before market open on **May 7, 2026**.

### Metallium (ASX: MTM)

Metallium released its Q1 2026 Quarterly Activities and Cashflow Report on April 13, 2026.

- **Operational Highlights:** Successfully completed Phase I of SBIR program with the **U.S. Department of War**, exceeding milestones for recovering gallium from electronic waste using **Flash Joule Heating (FJH)** technology. Secured a binding feedstock agreement with **Glencore** and long-term offtake agreement with **Indium Corporation**.
- **Financial Position:** Cash and cash equivalents approximately A\$82.00 million as of March 31, 2026 (following A\$75.00 million capital raise in January 2026). Net cash used in operating activities Q1: A\$5.74 million.

### NRx Pharmaceuticals (NRXP)

- **Executive Appointments:** On April 13, 2026, appointed **Glenn Tyson** as first Chief Commercial Officer to lead anticipated product launches including preservative-free ketamine (**NRX-100**).
- **Corporate Expansion:** On April 15, 2026, NRx announced incorporation of **NRx Defense Systems, Inc.**, a subsidiary focused on neuroplastic treatments for military and first responder applications. Will combine **D-cycloserine** with robotic-enabled Transcranial Magnetic Stimulation (TMS).
